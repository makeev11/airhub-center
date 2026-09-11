use super::*;
use axum::{extract::State, http::StatusCode, routing::post, Json, Router};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Mutex,
};

#[derive(Clone)]
struct Fixture {
    requests: Arc<Mutex<Vec<Value>>>,
    status: &'static str,
    requires_staff: bool,
    fail_first_send: bool,
    sends: Arc<AtomicUsize>,
}

async fn backend(
    State(state): State<Fixture>,
    Json(request): Json<Value>,
) -> (StatusCode, Json<Value>) {
    state.requests.lock().unwrap().push(request.clone());
    let value = match request["operation"].as_str() {
        Some("get_turn_context") => json!({"data":{
            "conversation":{"sourceMessageId":"source"},
            "history":{"messages":[{"id":"source","actor":"parent","content":"Подтверждаю"}]},
            "bookingDraft":{"state":"ready","version":7,"preview":"Итог записи"},
        }}),
        Some("commit_booking_draft") => json!({"status":"committed", "authoritativeResult":{
            "bookingId":"booking-one","status":state.status,"requiresStaff":state.requires_staff,
        }}),
        None => {
            assert_eq!(request["events"].as_array().unwrap().len(), 1);
            if state.sends.fetch_add(1, Ordering::SeqCst) == 0 && state.fail_first_send {
                return (
                    StatusCode::SERVICE_UNAVAILABLE,
                    Json(json!({"error":"temporary delivery failure"})),
                );
            }
            json!({"status":"completed","intents":[{"id":"reply-one"}]})
        }
        operation => panic!("unexpected operation: {operation:?}"),
    };
    (StatusCode::OK, Json(value))
}

async fn setup(
    status: &'static str,
    requires_staff: bool,
    fail_first_send: bool,
) -> (AirhopService, Fixture, tokio::task::JoinHandle<()>) {
    let fixture = Fixture {
        requests: Arc::new(Mutex::new(Vec::new())),
        status,
        requires_staff,
        fail_first_send,
        sends: Arc::new(AtomicUsize::new(0)),
    };
    let turn = Uuid::new_v4();
    let channel = Uuid::new_v4();
    let app = Router::new()
        .route(AGENT_BACKEND_PATH, post(backend))
        .route(
            &format!("/api/airhop/agents/v1/turns/{turn}/reply"),
            post(backend),
        )
        .with_state(fixture.clone());
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let grant = EventBuilder::new(
        Kind::Custom(buzz_core::kind::KIND_AIRHOP_AGENT_CONTEXT_GRANT as u16),
        json!({"channelId":channel,"turnId":turn,"turnLeaseToken":Uuid::new_v4()}).to_string(),
    )
    .sign_with_keys(&Keys::generate())
    .unwrap();
    let mut config = AirhopConfig::for_test(
        AirhopRole::ParentAdministrator,
        channel,
        &format!("http://{address}"),
        Keys::generate(),
    );
    config.context_grant = Some(
        base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(serde_json::to_vec(&grant).unwrap()),
    );
    (AirhopService::new(config), fixture, server)
}

fn confirmation() -> CommitBookingDraftParams {
    CommitBookingDraftParams {
        version: 7,
        confirmed_reply: Some("Запись подтверждена. Ждём вас!".into()),
    }
}

#[tokio::test]
async fn continuing_reply_waits_only_for_the_remaining_interval_before_publication() {
    let (service, state, server) = setup("confirmed", false, false).await;
    let grant = service.config.current_context_grant().unwrap().unwrap();
    let mut graph = service.dialogue.lock().await;
    graph.reset_for(grant);
    graph.observe(
        &json!({"operation":"get_turn_context"}),
        &mut json!({"data":{
            "conversation":{"sourceMessageId":"source"},
            "history":{"messages":[
                {"id":"prior","actor":"hermes","internal":false,"content":"Чем помочь?"},
                {"id":"source","actor":"parent","internal":false,"content":"Что принести?",
                 "receivedAt":chrono::Utc::now().to_rfc3339()}
            ]},
        }}),
    );
    drop(graph);
    let started = tokio::time::Instant::now();
    let reply = service.send_parent_reply(SendParentReplyParams {
        messages: vec!["Возьмите сменную обувь.".into()],
        consultation: None,
        handoff_reason: None,
    });
    tokio::pin!(reply);
    tokio::select! {
        result = &mut reply => panic!("reply published too soon: {result:?}"),
        _ = tokio::time::sleep(std::time::Duration::from_millis(100)) => {}
    }
    assert!(state.requests.lock().unwrap().is_empty());
    assert_eq!(reply.await.unwrap()["status"], "completed");
    assert!(started.elapsed() >= std::time::Duration::from_millis(1800));
    assert_eq!(state.requests.lock().unwrap().len(), 1);
    server.abort();
}

#[tokio::test]
async fn confirmation_commits_and_sends_without_an_extra_model_or_read_round() {
    let (service, state, server) = setup("confirmed", false, false).await;
    let context = service.get_turn_context().await.unwrap();
    assert_eq!(context["dialogue"]["node"], "confirm_booking");
    let result = service.commit_booking_draft(confirmation()).await.unwrap();
    assert_eq!(result["parentReply"]["status"], "completed");
    let duplicate = service
        .send_parent_reply(SendParentReplyParams {
            messages: vec!["Ещё одно подтверждение".into()],
            consultation: None,
            handoff_reason: None,
        })
        .await
        .unwrap();
    assert_eq!(duplicate["alreadySent"], true);
    let requests = state.requests.lock().unwrap();
    assert_eq!(requests.len(), 3);
    assert_eq!(requests[0]["operation"], "get_turn_context");
    assert_eq!(requests[1]["operation"], "commit_booking_draft");
    let events: Vec<Event> = serde_json::from_value(requests[2]["events"].clone()).unwrap();
    assert!(events[0].verify_signature());
    assert_eq!(events[0].content, "Запись подтверждена. Ждём вас!");
    server.abort();
}

#[tokio::test]
async fn delivery_retry_reuses_successful_booking_receipt() {
    let (service, state, server) = setup("confirmed", false, true).await;
    service.get_turn_context().await.unwrap();
    let failed_send = service.commit_booking_draft(confirmation()).await.unwrap();
    assert!(failed_send.get("deliveryError").is_some());
    assert_eq!(failed_send["authoritativeResult"]["status"], "confirmed");
    let retried = service.commit_booking_draft(confirmation()).await.unwrap();
    assert_eq!(retried["parentReply"]["status"], "completed");
    let requests = state.requests.lock().unwrap();
    assert_eq!(requests.len(), 4);
    assert_eq!(
        requests
            .iter()
            .filter(|request| request["operation"] == "commit_booking_draft")
            .count(),
        1
    );
    server.abort();
}

#[tokio::test]
async fn pending_rejected_or_staff_review_never_delivers_a_confirmation() {
    for (status, requires_staff) in [
        ("pending_confirmation", true),
        ("rejected", false),
        ("confirmed", true),
    ] {
        let (service, state, server) = setup(status, requires_staff, false).await;
        service.get_turn_context().await.unwrap();
        let result = service.commit_booking_draft(confirmation()).await.unwrap();
        assert!(result.get("parentReply").is_none());
        assert_eq!(state.requests.lock().unwrap().len(), 2);
        assert_eq!(state.sends.load(Ordering::SeqCst), 0);
        server.abort();
    }
}
