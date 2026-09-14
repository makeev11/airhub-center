//! Bind every lookup/reply to the same, freshly authorized source conversation.
use super::*;

impl AirhopService {
    pub(super) async fn require_current_conversation(
        &self,
        graph: &team_graph::TeamGraph,
        channel: Uuid,
    ) -> Result<(), AirhopError> {
        if graph.channel != Some(channel) || graph.task.is_empty() {
            return Err(AirhopError(
                "Load team context for this exact conversation first.".into(),
            ));
        }
        if graph.task.starts_with("kickoff:") {
            return self.config.require_channel(channel);
        }
        validate_hex_event_id(&graph.task, "sourceEventId")?;
        let route = self
            .config
            .request_json(
                Method::POST,
                &format!("/api/airhop/agents/v1/routes/{}/claim", graph.task),
                None,
            )
            .await?;
        if route["targetPubkey"].as_str() != Some(self.config.keys.public_key().to_hex().as_str())
            || route["channelId"].as_str() != Some(channel.to_string().as_str())
        {
            return Err(AirhopError(
                "Conversation access changed. Do not read or reply.".into(),
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::{
        extract::Json,
        http::StatusCode,
        routing::{get, post},
        Router,
    };
    use std::sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    };

    #[tokio::test]
    async fn dm_context_reads_and_flat_replies_bind_to_source_and_recheck_revocation() {
        let dm = Uuid::new_v4();
        let welcome = Uuid::new_v4();
        let source = "ab".repeat(32);
        let keys = Keys::generate();
        let agent = keys.public_key().to_hex();
        let revoked = Arc::new(AtomicBool::new(false));
        let revoked_route = revoked.clone();
        let posted = Arc::new(Mutex::new(Vec::<Value>::new()));
        let posted_route = posted.clone();
        let source_query = source.clone();
        let app = Router::new()
            .route(&format!("/api/airhop/agents/v1/routes/{source}/claim"), post(move || {
                let revoked = revoked_route.clone(); let agent = agent.clone();
                async move { if revoked.load(Ordering::SeqCst) {
                    (StatusCode::FORBIDDEN, Json(json!({"error":"conversation access revoked"})))
                } else { (StatusCode::OK, Json(json!({"targetPubkey":agent,"channelId":dm}))) } }
            }))
            .route(SETTINGS_PATH, get(|| async { Json(json!({"organization":{"id":Uuid::nil(),"name":"Test","locale":"ru-RU","timeZone":"UTC"}})) }))
            .route("/query", post(move || { let id = source_query.clone(); async move { Json(json!([{"id":id,"kind":9,"created_at":100,"tags":[["h",dm.to_string()]]}])) } }))
            .route("/events", post(move |Json(event): Json<Value>| { let posted = posted_route.clone(); async move { posted.lock().unwrap().push(event); Json(json!({"accepted":true})) } }));
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        let service = AirhopService::new(AirhopConfig::for_test(
            AirhopRole::Analyst,
            welcome,
            &format!("http://{address}"),
            keys,
        ));
        let context = |channel| GetTeamContextParams {
            channel_id: channel,
            source_event_id: Some(source.clone()),
            kickoff_stage: None,
        };
        let read = |channel| {
            serde_json::from_value::<ReadParams>(
                json!({"channelId":channel,"resource":"organization_settings"}),
            )
            .unwrap()
        };
        let reply = |channel| SendMessagesParams {
            channel_id: channel,
            messages: vec!["На связи".into()],
            responds_to: vec![source.clone()],
            kickoff_stage: None,
            expects_reply: false,
        };
        assert!(service.read(read(dm)).await.is_err());
        assert!(service.send_messages(reply(dm)).await.is_err());
        assert_eq!(
            service.get_team_context(context(dm)).await.unwrap()["channelId"],
            dm.to_string()
        );
        assert!(service.get_team_context(context(welcome)).await.is_err());
        assert!(service.read(read(welcome)).await.is_err());
        assert!(service.send_messages(reply(welcome)).await.is_err());
        service.read(read(dm)).await.unwrap();
        revoked.store(true, Ordering::SeqCst);
        assert!(service.read(read(dm)).await.is_err());
        assert!(service.send_messages(reply(dm)).await.is_err());
        assert!(posted.lock().unwrap().is_empty());
        revoked.store(false, Ordering::SeqCst);
        service.send_messages(reply(dm)).await.unwrap();
        assert!(service.send_messages(reply(dm)).await.is_err());
        let events = posted.lock().unwrap();
        assert_eq!(events.len(), 1);
        let tags = events[0]["tags"].as_array().unwrap();
        assert!(tags.contains(&json!(["h", dm.to_string()])));
        assert!(tags.contains(&json!(["airhop-responds-to", source])));
        assert!(!tags.iter().any(|tag| tag[0] == "e"));
        server.abort();
    }
}
