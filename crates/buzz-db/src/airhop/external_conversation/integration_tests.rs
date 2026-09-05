use super::*;
use crate::airhop::agent_runtime::{
    LeaseParentAgentTurnInput, LeasedParentAgentTurn, PutParentAgentDeploymentInput,
};
use crate::DbConfig;
use buzz_core::CommunityId;
use nostr::{EventBuilder, Keys, Kind, Tag};
use serde_json::json;

mod booking_handoff_tests;

struct Fixture {
    db: Db,
    tenant: TenantContext,
    owner: Keys,
    hermes: Keys,
    parent: Keys,
    channel: Uuid,
    conversation: Uuid,
}

impl Fixture {
    async fn new() -> Self {
        let db = Db::new(&DbConfig {
            database_url: std::env::var("BUZZ_TEST_DATABASE_URL")
                .expect("dedicated BUZZ_TEST_DATABASE_URL"),
            max_connections: 5,
            min_connections: 0,
            ..DbConfig::default()
        })
        .await
        .unwrap();
        db.migrate().await.unwrap();
        let community = Uuid::new_v4();
        let organization = Uuid::new_v4();
        let tenant = TenantContext::resolved(
            CommunityId::from_uuid(community),
            format!("hermes-{community}.test"),
        );
        let owner = Keys::generate();
        let hermes = Keys::generate();
        let parent = Keys::generate();
        let channel = Uuid::new_v4();
        let conversation = Uuid::new_v4();
        sqlx::query("INSERT INTO communities (id, host) VALUES ($1, $2)")
            .bind(community)
            .bind(format!("hermes-{community}.test"))
            .execute(&db.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO airhop_organizations (community_id, id, name, locale, time_zone, default_trial_policy) VALUES ($1, $2, 'Test', 'ru-RU', 'Europe/Moscow', $3)")
            .bind(community).bind(organization).bind(json!({"mode":"free"})).execute(&db.pool).await.unwrap();
        for (keys, name, role) in [
            (&owner, "Владелец", "owner"),
            (&hermes, "Администратор Гермес", "member"),
            (&parent, "Родитель", "member"),
        ] {
            sqlx::query(
                "INSERT INTO users (community_id, pubkey, display_name) VALUES ($1, $2, $3)",
            )
            .bind(community)
            .bind(keys.public_key().to_bytes().as_slice())
            .bind(name)
            .execute(&db.pool)
            .await
            .unwrap();
            sqlx::query(
                "INSERT INTO relay_members (community_id, pubkey, role) VALUES ($1, $2, $3)",
            )
            .bind(community)
            .bind(keys.public_key().to_hex())
            .bind(role)
            .execute(&db.pool)
            .await
            .unwrap();
        }
        db.put_airhop_parent_agent_deployment(
            &tenant,
            &PutParentAgentDeploymentInput {
                deployment_id: Uuid::new_v4(),
                agent_pubkey: hermes.public_key().to_bytes(),
                blueprint_version: 1,
                profile_ref: "test".into(),
                runtime_revision: "test".into(),
                persona_revision: "test".into(),
                skills_revision: "test".into(),
                model_revision: "test".into(),
                enabled: true,
                paused: false,
                manage_bookings: true,
                auto_confirm_online_bookings: None,
                expected_version: 0,
                registered_by_pubkey: owner.public_key().to_bytes(),
            },
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO channels (community_id, id, name, channel_type, visibility, created_by) VALUES ($1, $2, 'Parent', 'stream', 'private', $3)")
            .bind(community).bind(channel).bind(owner.public_key().to_bytes().as_slice()).execute(&db.pool).await.unwrap();
        for (keys, role) in [(&owner, "owner"), (&hermes, "bot"), (&parent, "member")] {
            sqlx::query("INSERT INTO channel_members (community_id, channel_id, pubkey, role) VALUES ($1, $2, $3, $4::member_role)")
                .bind(community).bind(channel).bind(keys.public_key().to_bytes().as_slice()).bind(role).execute(&db.pool).await.unwrap();
        }
        db.register_airhop_external_conversation(
            &tenant,
            &RegisterExternalConversationInput {
                conversation_id: conversation,
                channel_id: channel,
                family_id: None,
                representative_id: None,
                parent_pubkey: parent.public_key().to_bytes(),
                cycle_id: Uuid::new_v4(),
                expected_version: 0,
                opened_by_pubkey: owner.public_key().to_bytes(),
            },
        )
        .await
        .unwrap();
        let connection = Uuid::new_v4();
        sqlx::query("INSERT INTO airhop_channel_connections (community_id, organization_id, id, provider, display_name, connector_pubkey, updated_by_pubkey) VALUES ($1, $2, $3, 'telegram', 'Test', $4, $5)")
            .bind(community).bind(organization).bind(connection).bind(parent.public_key().to_bytes().as_slice())
            .bind(owner.public_key().to_bytes().as_slice()).execute(&db.pool).await.unwrap();
        sqlx::query("INSERT INTO airhop_external_conversation_routes (community_id, organization_id, conversation_id, connection_id, provider_chat_id, provider_chat_digest, updated_by_pubkey) VALUES ($1, $2, $3, $4, 'test-chat', $5, $6)")
            .bind(community).bind(organization).bind(conversation).bind(connection).bind([1u8;32].as_slice())
            .bind(owner.public_key().to_bytes().as_slice()).execute(&db.pool).await.unwrap();
        Self {
            db,
            tenant,
            owner,
            hermes,
            parent,
            channel,
            conversation,
        }
    }

    fn event(&self, keys: &Keys, text: &str, tags: Vec<Tag>) -> Event {
        EventBuilder::new(Kind::Custom(9), text)
            .tags([Tag::parse(["h", &self.channel.to_string()]).unwrap()])
            .tags(tags)
            .sign_with_keys(keys)
            .unwrap()
    }

    async fn insert(&self, event: &Event) -> ExternalConversationEventInsert {
        self.db
            .insert_airhop_external_conversation_event(
                &self.tenant,
                event,
                self.channel,
                None,
                None,
            )
            .await
            .unwrap()
            .unwrap()
    }

    async fn lease(&self, event: &Event) -> LeasedParentAgentTurn {
        let route = self
            .db
            .get_airhop_hermes_parent_event_route(
                &self.tenant,
                *event.id.as_bytes(),
                self.hermes.public_key().to_bytes(),
            )
            .await
            .unwrap()
            .unwrap();
        self.db
            .lease_airhop_parent_agent_turn(
                &self.tenant,
                &LeaseParentAgentTurnInput {
                    deployment_id: route.deployment_id,
                    channel_id: self.channel,
                    conversation_id: self.conversation,
                    cycle_id: route.cycle_id,
                    input_batch_id: Uuid::new_v4(),
                    source_message_id: *event.id.as_bytes(),
                    family_id: route.family_id,
                    representative_id: route.representative_id,
                    lease_seconds: 600,
                },
            )
            .await
            .unwrap()
    }

    async fn delivery_count(&self) -> i64 {
        sqlx::query_scalar("SELECT count(*) FROM airhop_external_message_outbox WHERE community_id=$1 AND conversation_id=$2")
            .bind(self.tenant.community().as_uuid()).bind(self.conversation).fetch_one(&self.db.pool).await.unwrap()
    }
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn staff_resume_is_internal_idempotent_and_claimable_with_current_profile_name() {
    let f = Fixture::new().await;
    let question = f.event(&f.parent, "Подскажите расписание", vec![]);
    f.insert(&question).await;
    let first = f.lease(&question).await;
    f.insert(&f.event(&f.owner, "Сейчас помогу", vec![])).await;
    let followup = f.event(&f.parent, "А завтра?", vec![]);
    f.insert(&followup).await;
    assert!(f
        .db
        .get_airhop_hermes_parent_event_route(
            &f.tenant,
            *followup.id.as_bytes(),
            f.hermes.public_key().to_bytes()
        )
        .await
        .unwrap()
        .is_none());
    let resume = f.event(
        &f.owner,
        "@Администратор Гермес, продолжай",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    assert!(f.insert(&resume).await.was_inserted);
    assert!(!f.insert(&resume).await.was_inserted);
    let next = f.lease(&resume).await;
    assert_ne!(first.turn.cycle_id, next.turn.cycle_id);
    assert_eq!(
        f.delivery_count().await,
        1,
        "only the staff's external answer is delivered"
    );
    assert!(f
        .db
        .get_airhop_hermes_parent_event_route(
            &f.tenant,
            *question.id.as_bytes(),
            f.hermes.public_key().to_bytes()
        )
        .await
        .unwrap()
        .is_none());
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn handoff_notifies_only_authorized_staff_and_never_leaks_internal_note() {
    let f = Fixture::new().await;
    let question = f.event(&f.parent, "Позовите человека", vec![]);
    f.insert(&question).await;
    let turn = f.lease(&question).await;
    let note = f.event(
        &f.hermes,
        "@Владелец, помогите родителю",
        vec![
            Tag::parse(["p", &f.owner.public_key().to_hex()]).unwrap(),
            Tag::parse(["airhop-handoff", "responsible"]).unwrap(),
        ],
    );
    let mut input = CommitHermesReplyInput {
        turn_id: turn.turn.id,
        lease_token: turn.turn.lease_token,
        agent_pubkey: f.hermes.public_key().to_bytes(),
        outcome: "human_handoff".into(),
        events: vec![
            f.event(&f.hermes, "Подключаю сотрудника.", vec![]),
            f.event(&f.hermes, "Он увидит наш разговор.", vec![]),
            f.event(&f.hermes, "Можно продолжить здесь.", vec![]),
            note,
        ],
    };
    let authorized_note = input.events.pop().unwrap();
    input.events.push(f.event(
        &f.hermes,
        "fake staff",
        vec![
            Tag::parse(["p", &f.parent.public_key().to_hex()]).unwrap(),
            Tag::parse(["airhop-handoff", "responsible"]).unwrap(),
        ],
    ));
    assert!(f
        .db
        .commit_airhop_hermes_reply(&f.tenant, &input)
        .await
        .is_err());
    input.events.pop();
    input.events.push(authorized_note);
    f.db.commit_airhop_hermes_reply(&f.tenant, &input)
        .await
        .unwrap();
    f.db.commit_airhop_hermes_reply(&f.tenant, &input)
        .await
        .unwrap();
    for event in &input.events {
        f.insert(event).await;
        f.insert(event).await;
    }
    assert_eq!(f.delivery_count().await, 3);
    let state: (String, bool) = sqlx::query_as("SELECT owner, hermes_paused FROM airhop_external_conversations WHERE community_id=$1 AND id=$2")
        .bind(f.tenant.community().as_uuid()).bind(f.conversation).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(state, ("human".into(), true));
    let other = TenantContext::resolved(CommunityId::from_uuid(Uuid::new_v4()), "other.test");
    assert!(f
        .db
        .get_airhop_conversation_handoff_targets(&other, f.channel)
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn staff_resume_does_not_bypass_disabled_channel_hermes_setting() {
    let f = Fixture::new().await;
    f.insert(&f.event(&f.owner, "Сейчас отвечу", vec![])).await;
    let resume = f.event(
        &f.owner,
        "@Администратор Гермес, продолжай",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&resume).await;
    let route =
        f.db.get_airhop_hermes_parent_event_route(
            &f.tenant,
            *resume.id.as_bytes(),
            f.hermes.public_key().to_bytes(),
        )
        .await
        .unwrap()
        .unwrap();
    sqlx::query("UPDATE airhop_channel_connections SET hermes_enabled=false WHERE community_id=$1")
        .bind(f.tenant.community().as_uuid())
        .execute(&f.db.pool)
        .await
        .unwrap();
    assert!(f
        .db
        .get_airhop_hermes_parent_event_route(
            &f.tenant,
            *resume.id.as_bytes(),
            f.hermes.public_key().to_bytes()
        )
        .await
        .unwrap()
        .is_none());
    assert!(f
        .db
        .lease_airhop_parent_agent_turn(
            &f.tenant,
            &LeaseParentAgentTurnInput {
                deployment_id: route.deployment_id,
                channel_id: f.channel,
                conversation_id: f.conversation,
                cycle_id: route.cycle_id,
                input_batch_id: Uuid::new_v4(),
                source_message_id: *resume.id.as_bytes(),
                family_id: None,
                representative_id: None,
                lease_seconds: 600,
            }
        )
        .await
        .is_err());
    assert_eq!(f.delivery_count().await, 1);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn trailing_internal_note_does_not_swallow_parent_or_resume_trigger() {
    let f = Fixture::new().await;
    let question = f.event(&f.parent, "Какие занятия завтра?", vec![]);
    f.insert(&question).await;
    let note = f.event(
        &f.owner,
        "@Гермес, это внутреннее уточнение",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&note).await;
    let ids = [*note.id.as_bytes(), *question.id.as_bytes()];
    let route = f
        .db
        .get_airhop_hermes_parent_batch_route(&f.tenant, &ids, f.hermes.public_key().to_bytes())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(route.source_message_id, *question.id.as_bytes());

    f.insert(&f.event(&f.owner, "Сейчас помогу", vec![])).await;
    assert!(
        f.db.get_airhop_hermes_parent_batch_route(
            &f.tenant,
            &ids,
            f.hermes.public_key().to_bytes()
        )
        .await
        .unwrap()
        .is_none(),
        "human takeover must invalidate the whole batch"
    );
    let resume = f.event(
        &f.owner,
        "@Администратор Гермес, продолжай",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&resume).await;
    let after_resume = f.event(
        &f.owner,
        "@Гермес, ещё одна внутренняя заметка",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&after_resume).await;
    let route =
        f.db.get_airhop_hermes_parent_batch_route(
            &f.tenant,
            &[
                *after_resume.id.as_bytes(),
                *resume.id.as_bytes(),
                *question.id.as_bytes(),
            ],
            f.hermes.public_key().to_bytes(),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(route.source_message_id, *resume.id.as_bytes());
    f.lease(&resume).await;
    assert_eq!(f.delivery_count().await, 1);
    assert!(
        f.db.get_airhop_hermes_parent_batch_route(
            &f.tenant,
            &[[0; 32], *resume.id.as_bytes()],
            f.hermes.public_key().to_bytes()
        )
        .await
        .unwrap()
        .is_none(),
        "an unknown anchor must not borrow another event's scope"
    );
    assert!(f
        .db
        .get_airhop_hermes_parent_batch_route(
            &f.tenant,
            &vec![*resume.id.as_bytes(); 501],
            f.hermes.public_key().to_bytes()
        )
        .await
        .is_err());
}
