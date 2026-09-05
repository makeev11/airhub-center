use super::*;
use crate::airhop::booking_handoff::BookingHandoffStatus;
use crate::airhop::public_booking::{
    CreatePublicBookingInput, PreferredContactChannel, PublicBookingApplicant, PublicBookingSurface,
};
use crate::airhop::public_management::{
    AgentFamilyManagementCommand, PublicManagementAction, PublicManagementCredential,
};
use crate::airhop::{ActorKind, AirhopActor};

async fn booking(f: &Fixture, seed: u8) -> (Uuid, Uuid, PublicManagementCredential) {
    booking_with_phone(f, seed, seed).await
}

async fn booking_with_phone(
    f: &Fixture,
    seed: u8,
    phone_seed: u8,
) -> (Uuid, Uuid, PublicManagementCredential) {
    let org =
        f.db.get_airhop_organization(&f.tenant)
            .await
            .unwrap()
            .unwrap()
            .id;
    let community_id = *f.tenant.community().as_uuid();
    let community = &community_id;
    let branch = Uuid::new_v4();
    let group = Uuid::new_v4();
    let rule = Uuid::new_v4();
    let date = Utc::now().date_naive() + chrono::Duration::days(7);
    sqlx::query("INSERT INTO airhop_branches (community_id, organization_id, id, name, address) VALUES ($1,$2,$3,'Центр','Адрес центра')")
        .bind(community).bind(org).bind(branch).execute(&f.db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_groups (community_id, organization_id, id, branch_id, name) VALUES ($1,$2,$3,$4,'Футбол')")
        .bind(community).bind(org).bind(group).bind(branch).execute(&f.db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_recurrence_rules (community_id, organization_id, id, group_id, starts_on, ends_on, start_time, end_time) VALUES ($1,$2,$3,$4,$5,$5,'10:00','11:00')")
        .bind(community).bind(org).bind(rule).bind(group).bind(date).execute(&f.db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_lesson_occurrences (community_id,organization_id,id,recurrence_rule_id,original_date,group_id,branch_id,original_start_time,original_end_time,effective_date,start_time,end_time,starts_at,ends_at,time_zone,trial_policy,allow_single_visits,track_attendance,status,source_rule_version,capacity) VALUES ($1,$2,$3,$4,$5,$6,$7,'10:00','11:00',$5,'10:00','11:00',($5::date + time '10:00') AT TIME ZONE 'Europe/Moscow',($5::date + time '11:00') AT TIME ZONE 'Europe/Moscow','Europe/Moscow',$8,FALSE,TRUE,'scheduled',1,1)")
        .bind(community).bind(org).bind(Uuid::new_v4()).bind(rule).bind(date).bind(group).bind(branch).bind(json!({"mode":"free"})).execute(&f.db.pool).await.unwrap();
    let credential = PublicManagementCredential {
        key_version: 1,
        token_digest: [seed; 32],
    };
    let result =
        f.db.create_public_booking(
            &f.tenant,
            &CreatePublicBookingInput {
                lesson_ref: airhop_core::StableLessonReference {
                    recurrence_rule_id: rule,
                    original_date: date,
                },
                applicant: PublicBookingApplicant {
                    parent_name: "Андрей Макеев".into(),
                    parent_first_name: None,
                    parent_last_name: None,
                    phone_normalized: format!("+79990000{phone_seed:03}"),
                    phone_display: format!("+79990000{phone_seed:03}"),
                    child_name: "Платон".into(),
                    child_first_name: None,
                    child_last_name: None,
                    child_birth_date: "2020-01-01".parse().unwrap(),
                    preferred_contact_channel: PreferredContactChannel::Telegram,
                    consent_policy_version: "public-booking-v1".into(),
                },
                surface: PublicBookingSurface::Standalone,
                attribution_branch_id: None,
                idempotency_digest: [seed; 32],
                phone_match_digest: [phone_seed; 32],
                request_hash: [seed; 32],
                management_token_digest: credential.token_digest,
                management_key_version: 1,
                consent_evidence: json!({"accepted":true}),
            },
        )
        .await
        .unwrap();
    (result.booking.id, result.booking.family_id, credential)
}

async fn connection(f: &Fixture) -> Uuid {
    let id: Uuid = sqlx::query_scalar("SELECT connection_id FROM airhop_external_conversation_routes WHERE community_id=$1 AND conversation_id=$2")
        .bind(f.tenant.community().as_uuid()).bind(f.conversation).fetch_one(&f.db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_channel_credentials (community_id, organization_id, connection_id, provider, credential_ciphertext, credential_nonce, credential_key_version, credential_fingerprint, provider_bot_id, provider_bot_username, updated_by_pubkey) SELECT community_id, organization_id, id, provider, $3, $4, 1, $5, '42', 'airhop_test_bot', updated_by_pubkey FROM airhop_channel_connections WHERE community_id=$1 AND id=$2")
        .bind(f.tenant.community().as_uuid()).bind(id).bind(vec![1u8;32]).bind(vec![2u8;12]).bind(vec![3u8;32])
        .execute(&f.db.pool).await.unwrap();
    id
}

async fn redeem(f: &Fixture, connection: Uuid, digest: u8) -> BookingHandoffStatus {
    f.db.consume_airhop_booking_handoff(
        &f.tenant,
        connection,
        f.conversation,
        f.parent.public_key().to_bytes(),
        [digest; 32],
    )
    .await
    .unwrap()
}

fn command(
    f: &Fixture,
    turn: &LeasedParentAgentTurn,
    family_id: Uuid,
    booking_id: Uuid,
    seed: u8,
) -> AgentFamilyManagementCommand {
    AgentFamilyManagementCommand {
        family_id,
        booking_id,
        deployment_id: turn.deployment.id,
        deployment_version: turn.deployment.version,
        turn_id: turn.turn.id,
        turn_lease_token: turn.turn.lease_token,
        idempotency_digest: [seed; 32],
        request_hash: [seed; 32],
        actor: AirhopActor {
            kind: ActorKind::Bot,
            pubkey: Some(f.hermes.public_key().to_bytes()),
            agent_pubkey: Some(f.hermes.public_key().to_bytes()),
            on_behalf_of_pubkey: None,
        },
    }
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn online_booking_start_binds_confirms_and_replies_in_one_existing_conversation() {
    let f = Fixture::new().await;
    let connection = connection(&f).await;
    let (booking_id, family, credential) = booking(&f, 41).await;
    let launch =
        f.db.issue_airhop_booking_handoff(&f.tenant, credential, [71; 32])
            .await
            .unwrap()
            .unwrap();
    assert_eq!(launch.bot_username, "airhop_test_bot");
    assert!(!f
        .db
        .is_airhop_booking_telegram_connected(&f.tenant, credential)
        .await
        .unwrap());
    assert_eq!(
        redeem(&f, connection, 71).await,
        BookingHandoffStatus::Connected
    );
    assert_eq!(
        redeem(&f, connection, 71).await,
        BookingHandoffStatus::Connected
    );
    assert!(f
        .db
        .is_airhop_booking_telegram_connected(&f.tenant, credential)
        .await
        .unwrap());
    assert_eq!(
        f.db.get_airhop_conversation_booking(&f.tenant, f.conversation, family)
            .await
            .unwrap(),
        Some(booking_id)
    );
    let inbound = f.event(
        &f.parent,
        "[Telegram: родитель подключился после записи]",
        vec![],
    );
    f.insert(&inbound).await;
    let turn = f.lease(&inbound).await;
    assert_eq!(turn.turn.family_id, Some(family));
    let input = command(&f, &turn, family, booking_id, 81);
    let result =
        f.db.apply_airhop_agent_family_management_action(
            &f.tenant,
            input.clone(),
            PublicManagementAction::ConfirmOnline,
        )
        .await
        .unwrap();
    assert_eq!(result.status, airhop_core::BookingStatus::Confirmed);
    let replay =
        f.db.apply_airhop_agent_family_management_action(
            &f.tenant,
            input,
            PublicManagementAction::ConfirmOnline,
        )
        .await
        .unwrap();
    assert!(replay.replayed);
    assert_eq!(replay.version, result.version);
    let reply = f.event(
        &f.hermes,
        "Андрей, запись подтверждена. Ждём вас с Платоном.",
        vec![],
    );
    f.db.commit_airhop_hermes_reply(
        &f.tenant,
        &CommitHermesReplyInput {
            turn_id: turn.turn.id,
            lease_token: turn.turn.lease_token,
            agent_pubkey: f.hermes.public_key().to_bytes(),
            outcome: "replied".into(),
            events: vec![reply.clone()],
        },
    )
    .await
    .unwrap();
    f.insert(&reply).await;
    assert_eq!(f.delivery_count().await, 1);
    let events: i64 = sqlx::query_scalar("SELECT count(*) FROM airhop_domain_events WHERE community_id=$1 AND stream_id=$2 AND event_type='airhop.booking.confirmed.v1'")
        .bind(f.tenant.community().as_uuid()).bind(booking_id).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(events, 1);
    let bindings: i64 = sqlx::query_scalar("SELECT count(*) FROM airhop_domain_events WHERE community_id=$1 AND event_type='airhop.representative.messenger-bound.v1' AND payload->>'conversationId'=$2")
        .bind(f.tenant.community().as_uuid()).bind(f.conversation.to_string()).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(
        bindings, 1,
        "a retried grant must not duplicate the audit event"
    );
    let links =
        f.db.list_airhop_family_conversations(&f.tenant, family, f.owner.public_key().to_bytes())
            .await
            .unwrap();
    assert_eq!(links.len(), 1);
    assert_eq!(links[0]["channelId"], json!(f.channel));
    assert!(f
        .db
        .list_airhop_family_conversations(
            &f.tenant,
            family,
            Keys::generate().public_key().to_bytes()
        )
        .await
        .unwrap()
        .is_empty());
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn typed_phone_match_cannot_authenticate_an_existing_family() {
    let f = Fixture::new().await;
    let connection = connection(&f).await;
    let (_, original_family, _) = booking(&f, 45).await;
    // Another anonymous booking typed the same phone and child name. It must
    // not inject new data into the established family or authenticate its chat.
    let (_, matched_family, credential) = booking_with_phone(&f, 46, 45).await;
    assert_ne!(matched_family, original_family);
    f.db.issue_airhop_booking_handoff(&f.tenant, credential, [77; 32])
        .await
        .unwrap();
    assert_eq!(
        redeem(&f, connection, 77).await,
        BookingHandoffStatus::Conflict
    );
    assert!(!f
        .db
        .is_airhop_booking_telegram_connected(&f.tenant, credential)
        .await
        .unwrap());
    let event = f.event(&f.parent, "Здравствуйте", vec![]);
    f.insert(&event).await;
    assert_eq!(f.lease(&event).await.turn.family_id, None);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn handoff_revocation_expiry_conflict_and_foreign_connector_fail_closed() {
    let f = Fixture::new().await;
    let connection = connection(&f).await;
    let (_, _, credential) = booking(&f, 42).await;
    let first =
        f.db.issue_airhop_booking_handoff(&f.tenant, credential, [72; 32])
            .await
            .unwrap()
            .unwrap();
    let retry =
        f.db.issue_airhop_booking_handoff(&f.tenant, credential, [72; 32])
            .await
            .unwrap()
            .unwrap();
    assert_eq!(first.expires_at, retry.expires_at);
    f.db.issue_airhop_booking_handoff(&f.tenant, credential, [73; 32])
        .await
        .unwrap();
    assert_eq!(
        redeem(&f, connection, 72).await,
        BookingHandoffStatus::Invalid
    );
    assert!(f
        .db
        .consume_airhop_booking_handoff(
            &f.tenant,
            connection,
            f.conversation,
            f.owner.public_key().to_bytes(),
            [73; 32]
        )
        .await
        .is_err());
    sqlx::query("UPDATE airhop_booking_messenger_handoffs SET expires_at = now() - interval '1 second' WHERE community_id=$1")
        .bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
    assert_eq!(
        redeem(&f, connection, 73).await,
        BookingHandoffStatus::Invalid
    );
    f.db.issue_airhop_booking_handoff(&f.tenant, credential, [74; 32])
        .await
        .unwrap();
    assert_eq!(
        redeem(&f, connection, 74).await,
        BookingHandoffStatus::Connected
    );
    let (_, _, other) = booking(&f, 43).await;
    f.db.issue_airhop_booking_handoff(&f.tenant, other, [75; 32])
        .await
        .unwrap();
    assert_eq!(
        redeem(&f, connection, 75).await,
        BookingHandoffStatus::Conflict
    );
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn online_confirmation_checks_policy_and_current_occurrence() {
    let f = Fixture::new().await;
    let connection = connection(&f).await;
    let (id, family, credential) = booking(&f, 44).await;
    f.db.issue_airhop_booking_handoff(&f.tenant, credential, [76; 32])
        .await
        .unwrap();
    assert_eq!(
        redeem(&f, connection, 76).await,
        BookingHandoffStatus::Connected
    );
    let inbound = f.event(&f.parent, "Здравствуйте", vec![]);
    f.insert(&inbound).await;
    let turn = f.lease(&inbound).await;
    sqlx::query("UPDATE airhop_agent_deployments SET auto_confirm_online_bookings=FALSE WHERE community_id=$1")
        .bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
    assert!(f
        .db
        .apply_airhop_agent_family_management_action(
            &f.tenant,
            command(&f, &turn, family, id, 82),
            PublicManagementAction::ConfirmOnline
        )
        .await
        .is_err());
    sqlx::query("UPDATE airhop_agent_deployments SET auto_confirm_online_bookings=TRUE WHERE community_id=$1")
        .bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
    sqlx::query("UPDATE airhop_lesson_occurrences SET status='cancelled' WHERE community_id=$1")
        .bind(f.tenant.community().as_uuid())
        .execute(&f.db.pool)
        .await
        .unwrap();
    assert!(f
        .db
        .apply_airhop_agent_family_management_action(
            &f.tenant,
            command(&f, &turn, family, id, 83),
            PublicManagementAction::ConfirmOnline
        )
        .await
        .is_err());
    let card =
        f.db.get_public_management_card(&f.tenant, credential)
            .await
            .unwrap()
            .unwrap();
    assert_eq!(card.status, airhop_core::BookingStatus::PendingConfirmation);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn staff_takeover_prevents_inflight_online_confirmation() {
    let f = Fixture::new().await;
    let connection = connection(&f).await;
    let (id, family, credential) = booking(&f, 47).await;
    f.db.issue_airhop_booking_handoff(&f.tenant, credential, [78; 32])
        .await
        .unwrap();
    assert_eq!(
        redeem(&f, connection, 78).await,
        BookingHandoffStatus::Connected
    );
    let inbound = f.event(&f.parent, "Проверьте запись", vec![]);
    f.insert(&inbound).await;
    let turn = f.lease(&inbound).await;
    f.insert(&f.event(&f.owner, "Сейчас проверю сам", vec![]))
        .await;
    assert!(f
        .db
        .apply_airhop_agent_family_management_action(
            &f.tenant,
            command(&f, &turn, family, id, 84),
            PublicManagementAction::ConfirmOnline,
        )
        .await
        .is_err());
    let card =
        f.db.get_public_management_card(&f.tenant, credential)
            .await
            .unwrap()
            .unwrap();
    assert_eq!(card.status, airhop_core::BookingStatus::PendingConfirmation);
}
