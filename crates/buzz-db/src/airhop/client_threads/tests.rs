use super::*;
use crate::airhop::agent_runtime::{LeaseParentAgentTurnInput, ValidateParentAgentTurnLeaseInput};
use crate::airhop::external_conversation::CommitHermesReplyInput;
use crate::{airhop::channel_gateway::*, DbConfig};
use airhop_core::client_conversations::BranchResponsiblesCommand;

mod runtime_scope_tests;

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn visible_root_filter_is_exact_and_retains_channel_permissions() {
    let f = Fixture::new().await;
    let connection = f.connection(ConnectionRouting::default()).await;
    let route = f.route(connection.id, 71).await;
    let root = f.event(&route, None, &f.connector, "/start");
    f.insert(connection.id, &route, &root, None, Some(71))
        .await
        .unwrap();
    let filter = ClientInboxFilter {
        channel_id: Some(route.channel_id),
        root_ids: Some(root.id.to_hex()),
        ..Default::default()
    };
    let result =
        f.db.client_inbox(&f.tenant, &f.owner.public_key().to_bytes(), &filter)
            .await
            .unwrap();
    assert_eq!(result["items"].as_array().unwrap().len(), 1);
    assert_eq!(
        result["items"][0]["connectorPubkey"],
        f.connector.public_key().to_hex()
    );
    let wrong_channel = ClientInboxFilter {
        channel_id: Some(Uuid::new_v4()),
        ..filter
    };
    assert!(f
        .db
        .client_inbox(&f.tenant, &f.owner.public_key().to_bytes(), &wrong_channel)
        .await
        .unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
    for roots in [
        "not-an-id".to_owned(),
        vec![root.id.to_hex(); 101].join(","),
    ] {
        assert!(f
            .db
            .client_inbox(
                &f.tenant,
                &f.owner.public_key().to_bytes(),
                &ClientInboxFilter {
                    root_ids: Some(roots),
                    ..Default::default()
                }
            )
            .await
            .is_err());
    }
}

struct Fixture {
    db: Db,
    tenant: TenantContext,
    org: Uuid,
    owner: Keys,
    connector: Keys,
    agent: Keys,
    staff: Keys,
    relay: Keys,
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn inbound_messages_do_not_create_alerts_and_legacy_jobs_are_retired() {
    let f = Fixture::new().await;
    let connection = f
        .connection(ConnectionRouting {
            buzz_channel_id: None,
            branch_id: None,
        })
        .await;
    let route = f.route(connection.id, 91).await;
    let root = f.event(&route, None, &f.connector, "Первое обращение");
    f.insert(connection.id, &route, &root, None, Some(91))
        .await
        .unwrap();
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM airhop_client_inbound_notifications WHERE community_id=$1",
    )
    .bind(f.cid())
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(
        count, 0,
        "new incoming messages must not enqueue duplicate alerts"
    );
    // Simulate a deferred job left behind by the previous release.
    sqlx::query("INSERT INTO airhop_client_inbound_notifications(community_id,organization_id,conversation_id,source_event_id) VALUES($1,$2,$3,$4)")
        .bind(f.cid()).bind(f.org).bind(route.conversation_id).bind(root.id.as_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    sqlx::query("UPDATE channel_members SET removed_at=now() WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3")
        .bind(f.cid()).bind(route.channel_id).bind(f.owner.public_key().to_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    f.db.prepare_client_inbound_notifications(&f.relay)
        .await
        .unwrap();
    let retired: bool = sqlx::query_scalar("SELECT notification_dispatched_at IS NOT NULL AND notification_event_id IS NULL FROM airhop_client_inbound_notifications WHERE community_id=$1 AND source_event_id=$2")
        .bind(f.cid()).bind(root.id.as_bytes().as_slice()).fetch_one(&f.db.pool).await.unwrap();
    assert!(retired);
    sqlx::query("UPDATE channel_members SET removed_at=NULL WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3")
        .bind(f.cid()).bind(route.channel_id).bind(f.owner.public_key().to_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    let next = f.route(connection.id, 92).await;
    let next_root = f.event(&next, None, &f.connector, "Другое обращение");
    f.insert(connection.id, &next, &next_root, None, Some(92))
        .await
        .unwrap();
    f.db.prepare_client_inbound_notifications(&f.relay)
        .await
        .unwrap();
    assert_eq!(
        f.db.pending_client_notifications_in(Some(f.tenant.community()))
            .await
            .unwrap()
            .len(),
        0
    );
    sqlx::query("UPDATE airhop_client_inbound_notifications SET next_attempt_at=now() WHERE community_id=$1 AND source_event_id=$2")
        .bind(f.cid()).bind(root.id.as_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    f.db.prepare_client_inbound_notifications(&f.relay)
        .await
        .unwrap();
    assert_eq!(
        f.db.pending_client_notifications_in(Some(f.tenant.community()))
            .await
            .unwrap()
            .len(),
        0
    );
}
impl Fixture {
    async fn new() -> Self {
        let db = Db::new(&DbConfig {
            database_url: std::env::var("BUZZ_TEST_DATABASE_URL").expect("isolated test database"),
            min_connections: 0,
            max_connections: 8,
            ..DbConfig::default()
        })
        .await
        .unwrap();
        db.migrate().await.unwrap();
        let tenant = TenantContext::resolved(
            CommunityId::from_uuid(Uuid::new_v4()),
            format!("threads-{}.test", Uuid::new_v4()),
        );
        let org = Uuid::new_v4();
        let f = Self {
            db,
            tenant,
            org,
            owner: Keys::generate(),
            connector: Keys::generate(),
            agent: Keys::generate(),
            staff: Keys::generate(),
            relay: Keys::generate(),
        };
        sqlx::query("INSERT INTO communities(id,host) VALUES($1,$2)")
            .bind(f.cid())
            .bind(f.tenant.host())
            .execute(&f.db.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO airhop_organizations(community_id,id,name,locale,time_zone,default_trial_policy) VALUES($1,$2,'Thread test','ru-RU','Europe/Moscow',$3)").bind(f.cid()).bind(org).bind(json!({"mode":"free"})).execute(&f.db.pool).await.unwrap();
        for (key, role) in [
            (&f.owner, "owner"),
            (&f.connector, "member"),
            (&f.staff, "member"),
        ] {
            sqlx::query("INSERT INTO relay_members(community_id,pubkey,role) VALUES($1,$2,$3)")
                .bind(f.cid())
                .bind(key.public_key().to_hex())
                .bind(role)
                .execute(&f.db.pool)
                .await
                .unwrap();
        }
        sqlx::query("INSERT INTO airhop_agent_deployments(community_id,organization_id,id,blueprint_key,blueprint_version,role,agent_pubkey,profile_ref,runtime_revision,persona_revision,skills_revision,model_revision,registered_by_pubkey) VALUES($1,$2,$3,'airhop.hermes.parent_administrator',1,'parent_administrator',$4,'test','test','test','test','test',$5)").bind(f.cid()).bind(org).bind(Uuid::new_v4()).bind(f.agent.public_key().to_bytes().as_slice()).bind(f.owner.public_key().to_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
        f
    }
    fn cid(&self) -> Uuid {
        *self.tenant.community().as_uuid()
    }
    async fn channel(&self) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO channels(community_id,id,name,channel_type,visibility,created_by,nip29_group_id) VALUES($1,$2,'branch','stream','private',$3,$4)").bind(self.cid()).bind(id).bind(self.owner.public_key().to_bytes().as_slice()).bind(id.to_string()).execute(&self.db.pool).await.unwrap();
        for (key, role) in [
            (&self.owner, "admin"),
            (&self.connector, "member"),
            (&self.staff, "member"),
            (&self.agent, "bot"),
        ] {
            sqlx::query("INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES($1,$2,$3,$4::member_role)").bind(self.cid()).bind(id).bind(key.public_key().to_bytes().as_slice()).bind(role).execute(&self.db.pool).await.unwrap();
        }
        id
    }
    async fn branch(&self, channel: Uuid, name: &str) -> Uuid {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO airhop_branches(community_id,organization_id,id,name,address,default_buzz_channel_id) VALUES($1,$2,$3,$4,'Address',$5)").bind(self.cid()).bind(self.org).bind(id).bind(name).bind(channel).execute(&self.db.pool).await.unwrap();
        id
    }
    fn connection_input(&self, routing: ConnectionRouting) -> PutChannelConnectionInput {
        PutChannelConnectionInput {
            connection_id: Uuid::new_v4(),
            routing: Some(routing),
            provider: "telegram".into(),
            display_name: "Test Telegram".into(),
            connector_pubkey: self.connector.public_key().to_bytes(),
            status: "active".into(),
            hermes_enabled: true,
            capabilities: json!({}),
            expected_version: 0,
            updated_by_pubkey: self.owner.public_key().to_bytes(),
        }
    }
    async fn connection(&self, routing: ConnectionRouting) -> ChannelConnection {
        self.db
            .put_airhop_channel_connection(&self.tenant, &self.connection_input(routing))
            .await
            .unwrap()
    }
    fn route_input(&self, connection: Uuid, seed: u8) -> ProvisionExternalConversationRouteInput {
        ProvisionExternalConversationRouteInput {
            connection_id: connection,
            provider_chat_id: format!("123{seed}"),
            provider_chat_digest: [seed; 32],
            connector_pubkey: self.connector.public_key().to_bytes(),
        }
    }
    async fn route(&self, connection: Uuid, seed: u8) -> ResolvedConversationRoute {
        self.db
            .provision_airhop_external_conversation_route(
                &self.tenant,
                &self.route_input(connection, seed),
            )
            .await
            .unwrap()
            .route
    }
    fn event(
        &self,
        route: &ResolvedConversationRoute,
        root: Option<&Event>,
        key: &Keys,
        content: &str,
    ) -> Event {
        let mut tags = vec![
            Tag::parse(["h", &route.channel_id.to_string()]).unwrap(),
            Tag::parse(["airhop-conversation", &route.conversation_id.to_string()]).unwrap(),
        ];
        if key.public_key() == self.connector.public_key() {
            tags.push(Tag::parse(["airhop-direction", "inbound"]).unwrap());
        }
        if let Some(root) = root {
            for marker in ["root", "reply"] {
                tags.push(Tag::parse(["e", &root.id.to_hex(), "", marker]).unwrap());
            }
        }
        EventBuilder::new(Kind::Custom(9), content)
            .tags(tags)
            .sign_with_keys(key)
            .unwrap()
    }
    async fn insert(
        &self,
        connection: Uuid,
        route: &ResolvedConversationRoute,
        event: &Event,
        root: Option<&Event>,
        digest: Option<u8>,
    ) -> Result<Option<super::super::external_conversation::ExternalConversationEventInsert>> {
        let created =
            |e: &Event| DateTime::from_timestamp(e.created_at.as_secs() as i64, 0).unwrap();
        let gateway = digest.map(|seed| GatewayInboundContext {
            connection_id: connection,
            provider_event_digest: [seed; 32],
            connector_pubkey: self.connector.public_key().to_bytes(),
        });
        self.db
            .insert_airhop_external_conversation_event(
                &self.tenant,
                event,
                route.channel_id,
                Some(ThreadMetadataParams {
                    event_id: event.id.as_bytes(),
                    event_created_at: created(event),
                    channel_id: route.channel_id,
                    parent_event_id: root.map(|r| r.id.as_bytes().as_slice()),
                    parent_event_created_at: root.map(created),
                    root_event_id: root.map(|r| r.id.as_bytes().as_slice()),
                    root_event_created_at: root.map(created),
                    depth: i32::from(root.is_some()),
                    broadcast: false,
                }),
                gateway.as_ref(),
            )
            .await
    }
    async fn row(&self, id: Uuid) -> Value {
        sqlx::query_scalar("SELECT to_jsonb(v) FROM airhop_external_conversations v WHERE community_id=$1 AND id=$2").bind(self.cid()).bind(id).fetch_one(&self.db.pool).await.unwrap()
    }
    async fn command(&self, id: Uuid, action: ClientAction) -> (ClientCommand, Value) {
        let command = ClientCommand {
            idempotency_key: Uuid::new_v4(),
            conversation_id: id,
            expected_version: self.row(id).await["version"].as_i64().unwrap(),
            action,
        };
        let result = self
            .db
            .apply_client_command(
                &self.tenant,
                &self.owner.public_key().to_bytes(),
                &command,
                &self.relay,
            )
            .await
            .unwrap();
        (command, result)
    }
}

#[tokio::test]
#[ignore = "requires BUZZ_TEST_DATABASE_URL for an isolated PostgreSQL"]
async fn shared_threads_resolve_race_root_replay_assignment_and_reopen() {
    let f = Fixture::new().await;
    let (central, central2) = tokio::join!(
        f.connection(ConnectionRouting::default()),
        f.connection(ConnectionRouting::default())
    );
    assert_eq!(central.buzz_channel_id, central2.buzz_channel_id);
    let channel = central.buzz_channel_id.unwrap();
    let before: i64 = sqlx::query_scalar("SELECT count(*) FROM channels WHERE community_id=$1")
        .bind(f.cid())
        .fetch_one(&f.db.pool)
        .await
        .unwrap();
    let (a, b) = tokio::join!(f.route(central.id, 1), f.route(central.id, 1));
    assert_eq!(a, b);
    assert_eq!(a.channel_id, channel);
    assert!(a.threaded);
    assert!(a.root_event_id.is_none());
    assert!(f.row(a.conversation_id).await["branch_id"].is_null());
    assert!(f
        .db
        .client_inbox(
            &f.tenant,
            &f.owner.public_key().to_bytes(),
            &ClientInboxFilter::default()
        )
        .await
        .unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
    let first = f.event(&a, None, &f.connector, "Хочу записаться");
    let competing = f.event(&a, None, &f.connector, "Какой филиал рядом?");
    let (accepted, rejected) = tokio::join!(
        f.insert(central.id, &a, &first, None, Some(1)),
        f.insert(central.id, &a, &competing, None, Some(2))
    );
    assert_ne!(accepted.is_ok(), rejected.is_ok());
    let (root, retry, loser_digest) = if accepted.is_ok() {
        (&first, &competing, 2)
    } else {
        (&competing, &first, 1)
    };
    let root_digest = if loser_digest == 2 { 1 } else { 2 };
    let canonical = f.route(central.id, 1).await;
    assert_eq!(canonical.root_event_id, Some(root.id.to_hex()));
    assert!(
        !f.insert(central.id, &a, root, None, Some(root_digest))
            .await
            .unwrap()
            .unwrap()
            .was_inserted
    );
    let retried = f.event(&canonical, Some(root), &f.connector, &retry.content);
    f.insert(
        central.id,
        &canonical,
        &retried,
        Some(root),
        Some(loser_digest),
    )
    .await
    .unwrap();
    let other = f.route(central.id, 3).await;
    let other_root = f.event(&other, None, &f.connector, "Другой клиент");
    f.insert(central.id, &other, &other_root, None, Some(3))
        .await
        .unwrap();
    let cross = f.event(&canonical, Some(&other_root), &f.connector, "Не тот тред");
    assert!(f
        .insert(central.id, &canonical, &cross, Some(&other_root), Some(4))
        .await
        .is_err());
    let after: i64 = sqlx::query_scalar("SELECT count(*) FROM channels WHERE community_id=$1")
        .bind(f.cid())
        .fetch_one(&f.db.pool)
        .await
        .unwrap();
    assert_eq!(before, after);
    let row = f.row(a.conversation_id).await;
    assert_eq!(
        row["assignee_pubkey"],
        format!("\\x{}", f.owner.public_key().to_hex())
    );
    let branch_channel = f.channel().await;
    let branch = f.branch(branch_channel, "Северный").await;
    let roster = BranchResponsiblesCommand {
        idempotency_key: Uuid::new_v4(),
        branch_id: branch,
        expected_version: 1,
        responsible_pubkeys: vec![f.staff.public_key().to_hex()],
    };
    let roster_result =
        f.db.set_branch_client_responsibles(&f.tenant, &f.owner.public_key().to_bytes(), &roster)
            .await
            .unwrap();
    assert_eq!(
        roster_result,
        f.db.set_branch_client_responsibles(&f.tenant, &f.owner.public_key().to_bytes(), &roster)
            .await
            .unwrap()
    );
    assert!(f
        .db
        .set_branch_client_responsibles(&f.tenant, &f.staff.public_key().to_bytes(), &roster)
        .await
        .is_err());
    // Responsible staff without common-channel membership cannot receive or read it.
    let (_, fallback) = f
        .command(
            a.conversation_id,
            ClientAction::AssignBranch { branch_id: branch },
        )
        .await;
    assert_eq!(fallback["assignee"], f.owner.public_key().to_hex());
    assert!(f
        .db
        .client_inbox(
            &f.tenant,
            &f.staff.public_key().to_bytes(),
            &ClientInboxFilter::default()
        )
        .await
        .unwrap()["items"]
        .as_array()
        .unwrap()
        .is_empty());
    sqlx::query("INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES($1,$2,$3,'member')").bind(f.cid()).bind(channel).bind(f.staff.public_key().to_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    let (command, assigned) = f
        .command(
            a.conversation_id,
            ClientAction::AssignBranch { branch_id: branch },
        )
        .await;
    assert_eq!(assigned["assignee"], f.staff.public_key().to_hex());
    assert_eq!(assigned["channelId"], channel.to_string());
    assert_eq!(assigned["rootEventId"], root.id.to_hex());
    for (assignee, expected) in [(&f.staff, true), (&f.owner, false)] {
        let inbox =
            f.db.client_inbox(
                &f.tenant,
                &f.owner.public_key().to_bytes(),
                &ClientInboxFilter {
                    assignee: Some(assignee.public_key().to_hex()),
                    ..ClientInboxFilter::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            inbox["items"]
                .as_array()
                .unwrap()
                .iter()
                .any(|item| item["id"] == a.conversation_id.to_string()),
            expected
        );
    }
    assert_eq!(
        assigned,
        f.db.apply_client_command(
            &f.tenant,
            &f.owner.public_key().to_bytes(),
            &command,
            &f.relay
        )
        .await
        .unwrap()
    );
    let mut stale = command.clone();
    stale.idempotency_key = Uuid::new_v4();
    assert!(matches!(
        f.db.apply_client_command(
            &f.tenant,
            &f.owner.public_key().to_bytes(),
            &stale,
            &f.relay
        )
        .await,
        Err(DbError::AirhopVersionConflict)
    ));
    let notices =
        f.db.pending_client_notifications_in(Some(f.tenant.community()))
            .await
            .unwrap();
    assert!(notices
        .iter()
        .any(|n| n.community_id == f.tenant.community()));
    let staff_template = f.event(&canonical, Some(root), &f.staff, "Помогу выбрать занятие");
    let mut staff_tags = staff_template.tags.to_vec();
    // Match the desktop reply shape: every thread reply carries the author's
    // own `p` tag in addition to its thread references.
    staff_tags.push(Tag::parse(["p", &f.staff.public_key().to_hex()]).unwrap());
    let staff_message = EventBuilder::new(Kind::Custom(9), staff_template.content)
        .tags(staff_tags)
        .sign_with_keys(&f.staff)
        .unwrap();
    f.insert(central.id, &canonical, &staff_message, Some(root), None)
        .await
        .unwrap();
    let queued: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM airhop_external_message_outbox WHERE community_id=$1 AND buzz_event_id=$2 AND actor_kind='staff' AND status='pending'",
    )
    .bind(f.cid())
    .bind(staff_message.id.as_bytes().as_slice())
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(queued, 1);
    let mut internal_tags = staff_message.tags.to_vec();
    internal_tags.push(Tag::parse(["p", &f.agent.public_key().to_hex()]).unwrap());
    let internal = EventBuilder::new(Kind::Custom(9), "Гермес, продолжай")
        .tags(internal_tags)
        .sign_with_keys(&f.staff)
        .unwrap();
    f.insert(central.id, &canonical, &internal, Some(root), None)
        .await
        .unwrap();
    let leaked:i64=sqlx::query_scalar("SELECT count(*) FROM airhop_external_message_outbox WHERE community_id=$1 AND buzz_event_id=$2").bind(f.cid()).bind(internal.id.as_bytes().as_slice()).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(leaked, 0);
    let cycle = f.row(a.conversation_id).await["current_cycle_id"].clone();
    f.command(
        a.conversation_id,
        ClientAction::SetStatus {
            status: "resolved".into(),
        },
    )
    .await;
    let next = f.event(&canonical, Some(root), &f.connector, "Ещё один вопрос");
    f.insert(central.id, &canonical, &next, Some(root), Some(5))
        .await
        .unwrap();
    let reopened = f.row(a.conversation_id).await;
    assert_ne!(reopened["current_cycle_id"], cycle);
    assert_eq!(reopened["queue_status"], "waiting_staff");
    assert_eq!(
        reopened["root_event_id"],
        format!("\\x{}", root.id.to_hex())
    );
    let branch_connection = f
        .connection(ConnectionRouting {
            buzz_channel_id: None,
            branch_id: Some(branch),
        })
        .await;
    let branch_route = f.route(branch_connection.id, 8).await;
    assert_eq!(branch_route.channel_id, branch_channel);
    assert_eq!(
        f.row(branch_route.conversation_id).await["branch_id"],
        branch.to_string()
    );
    let branch_root = f.event(&branch_route, None, &f.connector, "Филиальное подключение");
    f.insert(
        branch_connection.id,
        &branch_route,
        &branch_root,
        None,
        Some(8),
    )
    .await
    .unwrap();
    let foreign = TenantContext::resolved(CommunityId::from_uuid(Uuid::new_v4()), "foreign.test");
    assert!(f
        .db
        .apply_client_command(
            &foreign,
            &f.owner.public_key().to_bytes(),
            &command,
            &f.relay
        )
        .await
        .is_err());
    sqlx::query("UPDATE channel_members SET removed_at=now() WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3").bind(f.cid()).bind(branch_channel).bind(f.connector.public_key().to_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    assert!(f
        .db
        .provision_airhop_external_conversation_route(
            &f.tenant,
            &f.route_input(branch_connection.id, 9)
        )
        .await
        .is_err());
}

#[tokio::test]
#[ignore = "requires BUZZ_TEST_DATABASE_URL for an isolated PostgreSQL"]
async fn legacy_migration_preserves_signed_history_and_fences_old_output() {
    let f = Fixture::new().await;
    let connection = f.connection(ConnectionRouting::default()).await;
    let old = f.channel().await;
    let route = f.route(connection.id, 20).await;
    sqlx::query("UPDATE airhop_external_conversations SET threaded=FALSE,channel_id=$3 WHERE community_id=$1 AND id=$2").bind(f.cid()).bind(route.conversation_id).bind(old).execute(&f.db.pool).await.unwrap();
    let legacy = ResolvedConversationRoute {
        channel_id: old,
        threaded: false,
        ..route
    };
    let original = f.event(&legacy, None, &f.connector, "История старого контакта");
    f.insert(connection.id, &legacy, &original, None, Some(20))
        .await
        .unwrap();
    let preview =
        f.db.preview_client_migration(
            &f.tenant,
            &f.owner.public_key().to_bytes(),
            legacy.conversation_id,
        )
        .await
        .unwrap();
    let (command, result) = f
        .command(
            legacy.conversation_id,
            ClientAction::MigrateLegacy {
                expected_route_version: preview["routeVersion"].as_i64().unwrap(),
            },
        )
        .await;
    assert_eq!(
        result["channelId"],
        connection.buzz_channel_id.unwrap().to_string()
    );
    assert!(result["rootEventId"].is_string());
    assert_eq!(
        result,
        f.db.apply_client_command(
            &f.tenant,
            &f.owner.public_key().to_bytes(),
            &command,
            &f.relay
        )
        .await
        .unwrap()
    );
    let saved =
        f.db.get_event_by_id(f.tenant.community(), original.id.as_bytes())
            .await
            .unwrap()
            .unwrap();
    assert_eq!(saved.event, original);
    assert_eq!(saved.channel_id, Some(old));
    let archived: bool = sqlx::query_scalar(
        "SELECT archived_at IS NOT NULL FROM channels WHERE community_id=$1 AND id=$2",
    )
    .bind(f.cid())
    .bind(old)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert!(archived);
    let outbound = f.event(&legacy, None, &f.owner, "Нельзя отправлять из архива");
    assert!(f
        .insert(connection.id, &legacy, &outbound, None, None)
        .await
        .is_err());
    let current = f.route(connection.id, 20).await;
    assert_eq!(current.conversation_id, legacy.conversation_id);
    assert_eq!(
        current.root_event_id.as_deref(),
        result["rootEventId"].as_str()
    );
    let root =
        f.db.get_event_by_id(
            f.tenant.community(),
            &hex::decode(current.root_event_id.unwrap()).unwrap(),
        )
        .await
        .unwrap()
        .unwrap()
        .event;
    assert!(root.content.contains(&original.id.to_hex()));
}

#[tokio::test]
#[ignore = "requires BUZZ_TEST_DATABASE_URL for an isolated PostgreSQL"]
async fn parent_context_branch_evidence_threaded_reply_and_durable_notices() {
    let f = Fixture::new().await;
    let connection = f.connection(ConnectionRouting::default()).await;
    let route = f.route(connection.id, 30).await;
    let other = f.route(connection.id, 31).await;
    let root = f.event(&route, None, &f.connector, "Мне подходит Северный филиал");
    let other_root = f.event(&other, None, &f.connector, "Другой родитель");
    f.insert(connection.id, &route, &root, None, Some(30))
        .await
        .unwrap();
    f.insert(connection.id, &other, &other_root, None, Some(31))
        .await
        .unwrap();
    let mixed =
        f.db.get_airhop_hermes_parent_batch_route(
            &f.tenant,
            &[*root.id.as_bytes(), *other_root.id.as_bytes()],
            f.agent.public_key().to_bytes(),
        )
        .await
        .unwrap();
    assert!(mixed.is_none());
    let scope =
        f.db.get_airhop_hermes_parent_event_route(
            &f.tenant,
            *root.id.as_bytes(),
            f.agent.public_key().to_bytes(),
        )
        .await
        .unwrap()
        .unwrap();
    let turn =
        f.db.lease_airhop_parent_agent_turn(
            &f.tenant,
            &LeaseParentAgentTurnInput {
                deployment_id: scope.deployment_id,
                channel_id: scope.channel_id,
                conversation_id: scope.conversation_id,
                cycle_id: scope.cycle_id,
                input_batch_id: Uuid::new_v4(),
                source_message_id: scope.source_message_id,
                family_id: None,
                representative_id: None,
                lease_seconds: 300,
            },
        )
        .await
        .unwrap();
    let lease = ValidateParentAgentTurnLeaseInput {
        organization_id: f.org,
        deployment_id: scope.deployment_id,
        deployment_version: turn.deployment.version,
        turn_id: turn.turn.id,
        lease_token: turn.turn.lease_token,
        agent_pubkey: f.agent.public_key().to_bytes(),
    };
    let branch = f.branch(route.channel_id, "Северный").await;
    let command = ClientCommand {
        idempotency_key: Uuid::new_v4(),
        conversation_id: route.conversation_id,
        expected_version: f.row(route.conversation_id).await["version"]
            .as_i64()
            .unwrap(),
        action: ClientAction::AssignBranch { branch_id: branch },
    };
    assert!(f
        .db
        .assign_client_branch_from_parent(
            &f.tenant,
            &lease,
            &command,
            "придуманная цитата",
            &f.relay
        )
        .await
        .is_err());
    let assigned = f
        .db
        .assign_client_branch_from_parent(&f.tenant, &lease, &command, "Северный филиал", &f.relay)
        .await
        .unwrap();
    assert_eq!(assigned["branchId"], branch.to_string());
    assert_eq!(
        assigned,
        f.db.assign_client_branch_from_parent(
            &f.tenant,
            &lease,
            &command,
            "Северный филиал",
            &f.relay
        )
        .await
        .unwrap()
    );
    let mut crossed = command.clone();
    crossed.conversation_id = other.conversation_id;
    crossed.idempotency_key = Uuid::new_v4();
    assert!(f
        .db
        .assign_client_branch_from_parent(&f.tenant, &lease, &crossed, "Северный филиал", &f.relay)
        .await
        .is_err());
    f.db.prepare_client_inbound_notifications(&f.relay)
        .await
        .unwrap();
    let notices =
        f.db.pending_client_notifications_in(Some(f.tenant.community()))
            .await
            .unwrap()
            .into_iter()
            .filter(|n| n.community_id == f.tenant.community())
            .collect::<Vec<_>>();
    assert_eq!(
        notices.len(),
        1,
        "only the explicit branch assignment notice remains"
    );
    for notice in &notices {
        let event =
            f.db.get_event_by_id(f.tenant.community(), &notice.event_id)
                .await
                .unwrap()
                .unwrap()
                .event;
        assert!(event.verify_signature());
        assert!(event
            .tags
            .iter()
            .any(|tag| tag.as_slice() == ["p", &f.owner.public_key().to_hex()]));
    }
    f.db.prepare_client_inbound_notifications(&f.relay)
        .await
        .unwrap();
    assert_eq!(
        f.db.pending_client_notifications_in(Some(f.tenant.community()))
            .await
            .unwrap()
            .into_iter()
            .filter(|n| n.community_id == f.tenant.community())
            .count(),
        1
    );
    for notice in notices {
        f.db.complete_client_notification(f.tenant.community(), &notice.event_id)
            .await
            .unwrap();
    }
    let wrong = f.event(&route, Some(&other_root), &f.agent, "Чужая ветка запрещена");
    let mut reply = CommitHermesReplyInput {
        turn_id: turn.turn.id,
        lease_token: turn.turn.lease_token,
        agent_pubkey: f.agent.public_key().to_bytes(),
        outcome: "waiting_parent".into(),
        events: vec![wrong],
    };
    assert!(f
        .db
        .commit_airhop_hermes_reply(&f.tenant, &reply)
        .await
        .is_err());
    let good = f.event(&route, Some(&root), &f.agent, "Подскажите возраст ребёнка");
    reply.events = vec![good.clone()];
    f.db.commit_airhop_hermes_reply(&f.tenant, &reply)
        .await
        .unwrap();
    f.insert(connection.id, &route, &good, Some(&root), None)
        .await
        .unwrap();
    let jobs =
        f.db.claim_airhop_external_messages(
            &f.tenant,
            f.connector.public_key().to_bytes(),
            Some(connection.id),
            10,
            30,
        )
        .await
        .unwrap();
    assert_eq!(jobs.len(), 1);
    assert_eq!(jobs[0].event, good);
}

#[tokio::test]
#[ignore = "requires BUZZ_TEST_DATABASE_URL for an isolated PostgreSQL"]
async fn migration_blocks_pending_delivery_and_gateway_retries_survive_cutover() {
    let f = Fixture::new().await;
    let connection = f.connection(ConnectionRouting::default()).await;
    let old = f.channel().await;
    let route = f.route(connection.id, 40).await;
    sqlx::query("UPDATE airhop_external_conversations SET threaded=FALSE,channel_id=$3 WHERE community_id=$1 AND id=$2").bind(f.cid()).bind(route.conversation_id).bind(old).execute(&f.db.pool).await.unwrap();
    let legacy = ResolvedConversationRoute {
        channel_id: old,
        threaded: false,
        ..route
    };
    let root = f.event(&legacy, None, &f.connector, "До переноса");
    f.insert(connection.id, &legacy, &root, None, Some(40))
        .await
        .unwrap();
    let staff = f.event(&legacy, None, &f.owner, "Ответ сотрудника");
    f.insert(connection.id, &legacy, &staff, None, None)
        .await
        .unwrap();
    let command = ClientCommand {
        idempotency_key: Uuid::new_v4(),
        conversation_id: legacy.conversation_id,
        expected_version: f.row(legacy.conversation_id).await["version"]
            .as_i64()
            .unwrap(),
        action: ClientAction::MigrateLegacy {
            expected_route_version: 1,
        },
    };
    assert!(f
        .db
        .apply_client_command(
            &f.tenant,
            &f.owner.public_key().to_bytes(),
            &command,
            &f.relay
        )
        .await
        .is_err());
    let jobs =
        f.db.claim_airhop_external_messages(
            &f.tenant,
            f.connector.public_key().to_bytes(),
            Some(connection.id),
            10,
            30,
        )
        .await
        .unwrap();
    assert_eq!(jobs.len(), 1);
    assert!(f
        .db
        .apply_client_command(
            &f.tenant,
            &f.owner.public_key().to_bytes(),
            &command,
            &f.relay
        )
        .await
        .is_err());
    f.db.complete_airhop_external_message(
        &f.tenant,
        f.connector.public_key().to_bytes(),
        jobs[0].outbox_id,
        jobs[0].lease_token,
        &ExternalDeliveryCompletion::Delivered {
            provider_message_id: Some("test-delivery".into()),
        },
    )
    .await
    .unwrap();
    let preview =
        f.db.preview_client_migration(
            &f.tenant,
            &f.owner.public_key().to_bytes(),
            legacy.conversation_id,
        )
        .await
        .unwrap();
    f.command(
        legacy.conversation_id,
        ClientAction::MigrateLegacy {
            expected_route_version: preview["routeVersion"].as_i64().unwrap(),
        },
    )
    .await;
    let gateway = GatewayInboundContext {
        connection_id: connection.id,
        provider_event_digest: [40; 32],
        connector_pubkey: f.connector.public_key().to_bytes(),
    };
    assert!(f
        .db
        .check_client_gateway_retry(&f.tenant, &root, &gateway)
        .await
        .unwrap());
    let stale = f.event(&legacy, None, &f.connector, "Кандидат из старой очереди");
    assert!(
        matches!(f.db.check_client_gateway_retry(&f.tenant,&stale,&GatewayInboundContext{provider_event_digest:[41;32],..gateway}).await,Err(DbError::AccessDenied(message)) if message=="airhop_thread_changed")
    );
    let mut disabled = f.connection_input(ConnectionRouting::default());
    disabled.connection_id = connection.id;
    disabled.expected_version = connection.version;
    disabled.routing = None;
    disabled.status = "disabled".into();
    f.db.put_airhop_channel_connection(&f.tenant, &disabled)
        .await
        .unwrap();
    assert!(f
        .db
        .claim_airhop_external_messages(
            &f.tenant,
            f.connector.public_key().to_bytes(),
            Some(connection.id),
            10,
            30
        )
        .await
        .unwrap()
        .is_empty());
    assert!(f
        .db
        .check_client_gateway_retry(&f.tenant, &root, &gateway)
        .await
        .unwrap());
}
