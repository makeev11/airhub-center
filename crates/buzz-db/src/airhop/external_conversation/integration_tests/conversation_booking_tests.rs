use super::*;
use crate::airhop::agent_runtime::ValidateParentAgentTurnLeaseInput;
use crate::airhop::conversation_booking::{
    CommitConversationBookingInput, ConversationBookingDraft,
};
use airhop_core::conversation_booking::ConversationBookingData;
use airhop_core::{BookingStatus, StableLessonReference};

mod surname_tests;

async fn lesson(f: &Fixture) -> StableLessonReference {
    let org =
        f.db.get_airhop_organization(&f.tenant)
            .await
            .unwrap()
            .unwrap()
            .id;
    let community = *f.tenant.community().as_uuid();
    let branch = Uuid::new_v4();
    let group = Uuid::new_v4();
    let rule = Uuid::new_v4();
    let date = Utc::now().date_naive() + chrono::Duration::days(7);
    sqlx::query("INSERT INTO airhop_branches(community_id,organization_id,id,name,address) VALUES($1,$2,$3,'Творческая','Творческая 21')")
        .bind(community).bind(org).bind(branch).execute(&f.db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_groups(community_id,organization_id,id,branch_id,name,min_age_months,max_age_months) VALUES($1,$2,$3,$4,'Краски и истории',36,96)")
        .bind(community).bind(org).bind(group).bind(branch).execute(&f.db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_recurrence_rules(community_id,organization_id,id,group_id,starts_on,ends_on,start_time,end_time) VALUES($1,$2,$3,$4,$5,$5,'17:00','18:00')")
        .bind(community).bind(org).bind(rule).bind(group).bind(date).execute(&f.db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_lesson_occurrences(community_id,organization_id,id,recurrence_rule_id,original_date,group_id,branch_id,original_start_time,original_end_time,effective_date,start_time,end_time,starts_at,ends_at,time_zone,trial_policy,allow_single_visits,track_attendance,status,source_rule_version,capacity)
        VALUES($1,$2,$3,$4,$5,$6,$7,'17:00','18:00',$5,'17:00','18:00',($5::date+time '17:00') AT TIME ZONE 'Europe/Moscow',($5::date+time '18:00') AT TIME ZONE 'Europe/Moscow','Europe/Moscow',$8,FALSE,TRUE,'scheduled',1,1)")
        .bind(community).bind(org).bind(Uuid::new_v4()).bind(rule).bind(date).bind(group).bind(branch)
        .bind(json!({"mode":"paid","price":{"amountMinor":90000,"currency":"RUB"}})).execute(&f.db.pool).await.unwrap();
    StableLessonReference {
        recurrence_rule_id: rule,
        original_date: date,
    }
}

fn data(reference: StableLessonReference) -> ConversationBookingData {
    ConversationBookingData {
        recurrence_rule_id: Some(reference.recurrence_rule_id),
        original_date: Some(reference.original_date.to_string()),
        purpose: Some("trial".into()),
        child_id: None,
        parent_name: Some("Андрей".into()),
        parent_first_name: Some("Андрей".into()),
        parent_last_name: Some("Макеев".into()),
        phone: Some("+79990000123".into()),
        child_name: Some("Платон".into()),
        child_birth_date: Some(
            (Utc::now().date_naive() - chrono::Duration::days(5 * 365)).to_string(),
        ),
    }
}

fn lease(f: &Fixture, turn: &LeasedParentAgentTurn) -> ValidateParentAgentTurnLeaseInput {
    ValidateParentAgentTurnLeaseInput {
        organization_id: turn.deployment.organization_id,
        deployment_id: turn.deployment.id,
        deployment_version: turn.deployment.version,
        turn_id: turn.turn.id,
        lease_token: turn.turn.lease_token,
        agent_pubkey: f.hermes.public_key().to_bytes(),
    }
}

async fn inbound(f: &Fixture, text: &str) -> Event {
    let event = f.event(
        &f.parent,
        text,
        vec![Tag::parse(["nonce", &Uuid::new_v4().to_string()]).unwrap()],
    );
    f.insert(&event).await;
    sqlx::query("INSERT INTO airhop_gateway_inbound_receipts(community_id,organization_id,connection_id,conversation_id,provider_event_digest,buzz_event_id,connector_pubkey)
        SELECT r.community_id,r.organization_id,r.connection_id,r.conversation_id,$3,$3,c.connector_pubkey FROM airhop_external_conversation_routes r JOIN airhop_channel_connections c ON c.community_id=r.community_id AND c.id=r.connection_id WHERE r.community_id=$1 AND r.conversation_id=$2 ON CONFLICT DO NOTHING")
        .bind(f.tenant.community().as_uuid()).bind(f.conversation).bind(event.id.as_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    event
}

async fn prepare(
    f: &Fixture,
    reference: StableLessonReference,
) -> (LeasedParentAgentTurn, ConversationBookingDraft) {
    let event = inbound(f, "Хочу записаться").await;
    let turn = f.lease(&event).await;
    let draft =
        f.db.save_airhop_booking_draft(&f.tenant, &lease(f, &turn), 0, data(reference))
            .await
            .unwrap();
    assert_eq!(draft.state, "ready");
    assert!(draft.preview.as_ref().unwrap().contains("900 RUB"));
    assert!(draft.preview.as_ref().unwrap().contains("Творческая 21"));
    (turn, draft)
}

async fn publish(
    f: &Fixture,
    turn: &LeasedParentAgentTurn,
    draft: &ConversationBookingDraft,
    delivered: bool,
) {
    let reply = f.event(
        &f.hermes,
        draft.preview.as_ref().unwrap(),
        vec![Tag::parse(["airhop-hermes-turn", &turn.turn.id.to_string()]).unwrap()],
    );
    f.db.commit_airhop_hermes_reply(
        &f.tenant,
        &CommitHermesReplyInput {
            turn_id: turn.turn.id,
            lease_token: turn.turn.lease_token,
            agent_pubkey: f.hermes.public_key().to_bytes(),
            outcome: "answered".into(),
            events: vec![reply.clone()],
        },
    )
    .await
    .unwrap();
    f.insert(&reply).await;
    if delivered {
        sqlx::query("UPDATE airhop_external_message_outbox SET status='delivered',delivered_at=clock_timestamp() WHERE community_id=$1 AND buzz_event_id=$2")
            .bind(f.tenant.community().as_uuid()).bind(reply.id.as_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    }
}

fn commit_input(
    f: &Fixture,
    turn: &LeasedParentAgentTurn,
    version: i64,
) -> CommitConversationBookingInput {
    CommitConversationBookingInput {
        lease: lease(f, turn),
        version,
        phone_match_digest: [71; 32],
        command_digest: [81; 32],
        management_token_digest: [91; 32],
    }
}

async fn count(f: &Fixture, table: &str) -> i64 {
    let query = match table {
        "airhop_families" => "SELECT count(*) FROM airhop_families WHERE community_id=$1",
        "airhop_representatives" => {
            "SELECT count(*) FROM airhop_representatives WHERE community_id=$1"
        }
        "airhop_children" => "SELECT count(*) FROM airhop_children WHERE community_id=$1",
        "airhop_bookings" => "SELECT count(*) FROM airhop_bookings WHERE community_id=$1",
        "airhop_consents" => "SELECT count(*) FROM airhop_consents WHERE community_id=$1",
        "airhop_messenger_accounts" => {
            "SELECT count(*) FROM airhop_messenger_accounts WHERE community_id=$1"
        }
        _ => panic!("Unexpected test table"),
    };
    sqlx::query_scalar(query)
        .bind(f.tenant.community().as_uuid())
        .fetch_one(&f.db.pool)
        .await
        .unwrap()
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_creates_confirms_binds_and_replays() {
    assert_booking_binds_same_conversation(Fixture::new().await).await;
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_binds_shared_thread_without_replacing_root() {
    assert_booking_binds_same_conversation(Fixture::new_threaded().await).await;
}

async fn assert_booking_binds_same_conversation(f: Fixture) {
    let location:Value=sqlx::query_scalar("SELECT jsonb_build_array(channel_id,encode(root_event_id,'hex')) FROM airhop_external_conversations WHERE community_id=$1 AND id=$2").bind(f.tenant.community().as_uuid()).bind(f.conversation).fetch_one(&f.db.pool).await.unwrap();
    let reference = lesson(&f).await;
    let (turn, draft) = prepare(&f, reference).await;
    assert_eq!(count(&f, "airhop_families").await, 0);
    assert_eq!(count(&f, "airhop_bookings").await, 0);
    // A save retry neither resets the summary nor consumes a revision.
    let retry =
        f.db.save_airhop_booking_draft(&f.tenant, &lease(&f, &turn), 0, data(reference))
            .await
            .unwrap();
    assert_eq!(retry.version, draft.version);
    publish(&f, &turn, &draft, true).await;
    let yes = inbound(&f, "Подтверждаю запись").await;
    let confirm_turn = f.lease(&yes).await;
    let input = commit_input(&f, &confirm_turn, draft.version);
    let result =
        f.db.commit_airhop_booking_draft(&f.tenant, &input)
            .await
            .unwrap();
    assert_eq!(result.status, BookingStatus::Confirmed);
    assert!(!result.requires_staff);
    let replay =
        f.db.commit_airhop_booking_draft(&f.tenant, &input)
            .await
            .unwrap();
    assert!(replay.replayed);
    assert_eq!(result.booking_id, replay.booking_id);
    // An already booked pre-upgrade receipt must not require collecting a
    // surname again or create another family just to replay its result.
    sqlx::query("UPDATE airhop_conversation_booking_drafts SET data=data-'parentFirstName'-'parentLastName' WHERE community_id=$1 AND state='booked'")
        .bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
    let legacy_replay =
        f.db.commit_airhop_booking_draft(&f.tenant, &input)
            .await
            .unwrap();
    assert!(legacy_replay.replayed);
    assert_eq!(legacy_replay.booking_id, result.booking_id);
    for table in [
        "airhop_families",
        "airhop_representatives",
        "airhop_children",
        "airhop_bookings",
        "airhop_consents",
        "airhop_messenger_accounts",
    ] {
        assert_eq!(count(&f, table).await, 1, "{table}");
    }
    let binding:(Option<Uuid>,Option<Uuid>)=sqlx::query_as("SELECT family_id,representative_id FROM airhop_external_conversations WHERE community_id=$1 AND id=$2")
        .bind(f.tenant.community().as_uuid()).bind(f.conversation).fetch_one(&f.db.pool).await.unwrap();
    assert!(binding.0.is_some() && binding.1.is_some());
    let evidence: Value =
        sqlx::query_scalar("SELECT evidence FROM airhop_consents WHERE community_id=$1")
            .bind(f.tenant.community().as_uuid())
            .fetch_one(&f.db.pool)
            .await
            .unwrap();
    assert_eq!(evidence["sourceMessageId"], yes.id.to_hex());
    let reply = f.event(&f.hermes, "Запись подтверждена", vec![]);
    f.db.commit_airhop_hermes_reply(
        &f.tenant,
        &CommitHermesReplyInput {
            turn_id: confirm_turn.turn.id,
            lease_token: confirm_turn.turn.lease_token,
            agent_pubkey: f.hermes.public_key().to_bytes(),
            outcome: "answered".into(),
            events: vec![reply.clone()],
        },
    )
    .await
    .unwrap();
    f.insert(&reply).await;
    let next = inbound(&f, "Что взять с собой?").await;
    let next_turn = f.lease(&next).await;
    assert_eq!(next_turn.turn.family_id, binding.0);
    let after:Value=sqlx::query_scalar("SELECT jsonb_build_array(channel_id,encode(root_event_id,'hex')) FROM airhop_external_conversations WHERE community_id=$1 AND id=$2").bind(f.tenant.community().as_uuid()).bind(f.conversation).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(location, after);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_requires_delivered_summary_and_parent_confirmation() {
    for (delivered, text) in [
        (false, "Подтверждаю запись"),
        (true, "да, но в другое время"),
        (true, "не подтверждаю"),
    ] {
        let f = Fixture::new().await;
        let reference = lesson(&f).await;
        let (turn, draft) = prepare(&f, reference).await;
        publish(&f, &turn, &draft, delivered).await;
        let event = inbound(&f, text).await;
        let confirm = f.lease(&event).await;
        assert!(f
            .db
            .commit_airhop_booking_draft(&f.tenant, &commit_input(&f, &confirm, draft.version))
            .await
            .is_err());
        assert_eq!(count(&f, "airhop_bookings").await, 0);
        assert_eq!(count(&f, "airhop_families").await, 0);
    }
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_rechecks_controls_and_isolates_tenants() {
    for mode in [
        "permission",
        "pause",
        "connection",
        "tenant",
        "stale",
        "newer",
    ] {
        let f = Fixture::new().await;
        let reference = lesson(&f).await;
        let (turn, draft) = prepare(&f, reference).await;
        publish(&f, &turn, &draft, true).await;
        let event = inbound(&f, "Подтверждаю запись").await;
        let confirm = f.lease(&event).await;
        let mut input = commit_input(&f, &confirm, draft.version);
        match mode {
            "permission" => {
                sqlx::query("UPDATE airhop_agent_deployments SET manage_bookings=false WHERE community_id=$1").bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
            }
            "pause" => {
                f.insert(&f.event(&f.owner, "Я отвечу сам", vec![])).await;
            }
            "connection" => {
                sqlx::query("UPDATE airhop_channel_connections SET hermes_enabled=false WHERE community_id=$1").bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
            }
            "tenant" => {
                input.lease.organization_id = Uuid::new_v4();
            }
            "stale" => {
                input.version += 1;
            }
            "newer" => {
                inbound(&f, "Нет, передумал").await;
            }
            _ => unreachable!(),
        }
        assert!(
            f.db.commit_airhop_booking_draft(&f.tenant, &input)
                .await
                .is_err(),
            "{mode}"
        );
        assert_eq!(count(&f, "airhop_bookings").await, 0, "{mode}");
    }
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_partial_edits_and_cancel_survive_turns() {
    let f = Fixture::new().await;
    let reference = lesson(&f).await;
    let event = inbound(&f, "Хочу записаться").await;
    let turn = f.lease(&event).await;
    let partial = ConversationBookingData {
        parent_name: Some("Андрей".into()),
        ..Default::default()
    };
    let draft =
        f.db.save_airhop_booking_draft(&f.tenant, &lease(&f, &turn), 0, partial)
            .await
            .unwrap();
    assert_eq!(draft.state, "collecting");
    assert!(draft.preview.is_none());
    let stored =
        f.db.get_airhop_booking_draft(&f.tenant, f.conversation)
            .await
            .unwrap()
            .unwrap();
    assert_eq!(stored.data, draft.data);
    let ready = f
        .db
        .save_airhop_booking_draft(&f.tenant, &lease(&f, &turn), draft.version, data(reference))
        .await
        .unwrap();
    assert_eq!(ready.version, 2);
    let cancelled =
        f.db.cancel_airhop_booking_draft(&f.tenant, &lease(&f, &turn), ready.version)
            .await
            .unwrap();
    assert_eq!(cancelled.state, "cancelled");
    assert!(f
        .db
        .commit_airhop_booking_draft(&f.tenant, &commit_input(&f, &turn, ready.version))
        .await
        .is_err());
    assert_eq!(count(&f, "airhop_bookings").await, 0);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_rechecks_price_age_and_last_seat() {
    for mode in ["price", "age", "full"] {
        let f = Fixture::new().await;
        let reference = lesson(&f).await;
        let (turn, draft) = prepare(&f, reference).await;
        publish(&f, &turn, &draft, true).await;
        let event = inbound(&f, "Подтверждаю запись").await;
        let confirm = f.lease(&event).await;
        if mode == "full" {
            public_booking(&f, reference, 19, 19, "+79990000019")
                .await
                .unwrap();
        }
        let sql=match mode {
            "price"=>"UPDATE airhop_lesson_occurrences SET trial_policy='{\"mode\":\"paid\",\"price\":{\"amountMinor\":100000,\"currency\":\"RUB\"}}' WHERE community_id=$1",
            "age"=>"UPDATE airhop_groups SET min_age_months=80 WHERE community_id=$1",
            _=>"UPDATE airhop_lesson_occurrences SET capacity=1 WHERE community_id=$1",
        };
        sqlx::query(sql)
            .bind(f.tenant.community().as_uuid())
            .execute(&f.db.pool)
            .await
            .unwrap();
        assert!(
            f.db.commit_airhop_booking_draft(&f.tenant, &commit_input(&f, &confirm, draft.version))
                .await
                .is_err(),
            "{mode}"
        );
        let initial = i64::from(mode == "full");
        assert_eq!(count(&f, "airhop_bookings").await, initial);
        assert_eq!(count(&f, "airhop_families").await, initial);
        if mode == "price" {
            let updated =
                f.db.save_airhop_booking_draft(
                    &f.tenant,
                    &lease(&f, &confirm),
                    draft.version,
                    data(reference),
                )
                .await
                .unwrap();
            assert_eq!(updated.version, draft.version + 1);
            assert!(updated.preview.unwrap().contains("1000 RUB"));
        }
    }
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_respects_auto_confirm_switch() {
    let f = Fixture::new().await;
    let reference = lesson(&f).await;
    let (turn, draft) = prepare(&f, reference).await;
    publish(&f, &turn, &draft, true).await;
    let event = inbound(&f, "Подтверждаю запись").await;
    let confirm = f.lease(&event).await;
    sqlx::query("UPDATE airhop_agent_deployments SET auto_confirm_online_bookings=false WHERE community_id=$1").bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
    let result =
        f.db.commit_airhop_booking_draft(&f.tenant, &commit_input(&f, &confirm, draft.version))
            .await
            .unwrap();
    assert_eq!(result.status, BookingStatus::PendingConfirmation);
    assert!(result.requires_staff);
    assert_pending_in_staff_queue(&f, result.booking_id, false).await;
    assert_eq!(count(&f, "airhop_bookings").await, 1);
}

async fn assert_pending_in_staff_queue(f: &Fixture, booking_id: Uuid, possible_duplicate: bool) {
    use crate::airhop::staff_queue::{StaffBookingAttentionReason, StaffBookingQueueFilter};
    for attention_only in [false, true] {
        let page =
            f.db.list_airhop_staff_booking_queue(
                &f.tenant,
                StaffBookingQueueFilter {
                    status: Some(BookingStatus::PendingConfirmation),
                    attention_only,
                    limit: 100,
                    cursor: None,
                },
            )
            .await
            .unwrap();
        let row = page
            .items
            .iter()
            .find(|row| row.booking_id == booking_id)
            .expect("Hermes pending booking must appear in Requests");
        assert!(row
            .attention_reasons
            .contains(&StaffBookingAttentionReason::PendingConfirmation));
        assert_eq!(
            row.attention_reasons
                .contains(&StaffBookingAttentionReason::PossibleDuplicate),
            possible_duplicate
        );
    }
}

async fn public_booking(
    f: &Fixture,
    reference: StableLessonReference,
    seed: u8,
    phone_seed: u8,
    phone: &str,
) -> crate::Result<crate::airhop::public_booking::CreatePublicBookingOutcome> {
    use crate::airhop::public_booking::{
        CreatePublicBookingInput, PreferredContactChannel, PublicBookingApplicant,
        PublicBookingSurface,
    };
    let data = data(reference);
    f.db.create_public_booking(
        &f.tenant,
        &CreatePublicBookingInput {
            lesson_ref: reference,
            applicant: PublicBookingApplicant {
                parent_name: "Existing parent".into(),
                parent_first_name: None,
                parent_last_name: None,
                phone_normalized: phone.into(),
                phone_display: phone.into(),
                child_name: "Existing child".into(),
                child_first_name: None,
                child_last_name: None,
                child_birth_date: data.child_birth_date.unwrap().parse().unwrap(),
                preferred_contact_channel: PreferredContactChannel::Telegram,
                consent_policy_version: "public-booking-v1".into(),
            },
            surface: PublicBookingSurface::Standalone,
            attribution_branch_id: None,
            analytics_attribution: None,
            idempotency_digest: [seed; 32],
            phone_match_digest: [phone_seed; 32],
            request_hash: [seed; 32],
            management_token_digest: [seed; 32],
            management_key_version: 1,
            consent_evidence: json!({"accepted":true}),
        },
    )
    .await
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_does_not_authenticate_an_existing_family_by_phone() {
    let f = Fixture::new().await;
    let reference = lesson(&f).await;
    sqlx::query("UPDATE airhop_lesson_occurrences SET capacity=2 WHERE community_id=$1")
        .bind(f.tenant.community().as_uuid())
        .execute(&f.db.pool)
        .await
        .unwrap();
    let existing = public_booking(&f, reference, 18, 71, "+79990000123")
        .await
        .unwrap();
    let (turn, draft) = prepare(&f, reference).await;
    publish(&f, &turn, &draft, true).await;
    let event = inbound(&f, "Подтверждаю запись").await;
    let confirm = f.lease(&event).await;
    let result =
        f.db.commit_airhop_booking_draft(&f.tenant, &commit_input(&f, &confirm, draft.version))
            .await
            .unwrap();
    assert_eq!(result.status, BookingStatus::PendingConfirmation);
    assert!(result.requires_staff);
    let family: Uuid =
        sqlx::query_scalar("SELECT family_id FROM airhop_bookings WHERE community_id=$1 AND id=$2")
            .bind(f.tenant.community().as_uuid())
            .bind(result.booking_id)
            .fetch_one(&f.db.pool)
            .await
            .unwrap();
    assert_ne!(family, existing.booking.family_id);
    // The phone collision blocks auto-confirmation but must not hide the
    // resulting request from the employee who needs to review it.
    assert_pending_in_staff_queue(&f, result.booking_id, true).await;
    assert_eq!(count(&f, "airhop_families").await, 2);
    assert_eq!(count(&f, "airhop_messenger_accounts").await, 0);
    let bound: Option<Uuid> = sqlx::query_scalar(
        "SELECT family_id FROM airhop_external_conversations WHERE community_id=$1 AND id=$2",
    )
    .bind(f.tenant.community().as_uuid())
    .bind(f.conversation)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert!(bound.is_none());
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_concurrent_commit_is_idempotent() {
    // Concurrent retries of the same command serialize on the conversation.
    let f = Fixture::new().await;
    let reference = lesson(&f).await;
    let (turn, draft) = prepare(&f, reference).await;
    publish(&f, &turn, &draft, true).await;
    let event = inbound(&f, "Подтверждаю запись").await;
    let confirm = f.lease(&event).await;
    let input = commit_input(&f, &confirm, draft.version);
    let (a, b) = tokio::join!(
        f.db.commit_airhop_booking_draft(&f.tenant, &input),
        f.db.commit_airhop_booking_draft(&f.tenant, &input)
    );
    let (a, b) = (a.unwrap(), b.unwrap());
    assert_eq!(a.booking_id, b.booking_id);
    assert_ne!(a.replayed, b.replayed);
    assert_eq!(count(&f, "airhop_bookings").await, 1);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_rejects_staff_resume_as_consent() {
    let f = Fixture::new().await;
    let reference = lesson(&f).await;
    let (turn, draft) = prepare(&f, reference).await;
    publish(&f, &turn, &draft, true).await;
    f.insert(&f.event(&f.owner, "Помогу", vec![])).await;
    let resume = f.event(
        &f.owner,
        "@Администратор Гермес, продолжай",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&resume).await;
    let next = f.lease(&resume).await;
    assert!(f
        .db
        .commit_airhop_booking_draft(&f.tenant, &commit_input(&f, &next, draft.version))
        .await
        .is_err());
    assert_eq!(count(&f, "airhop_families").await, 0);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_races_public_booking_for_the_last_seat() {
    for _ in 0..5 {
        let f = Fixture::new().await;
        let reference = lesson(&f).await;
        let (turn, draft) = prepare(&f, reference).await;
        publish(&f, &turn, &draft, true).await;
        let event = inbound(&f, "Подтверждаю запись").await;
        let confirm = f.lease(&event).await;
        let input = commit_input(&f, &confirm, draft.version);
        let (chat, web) = tokio::join!(
            f.db.commit_airhop_booking_draft(&f.tenant, &input),
            public_booking(&f, reference, 20, 20, "+79990000020")
        );
        assert_ne!(
            chat.is_ok(),
            web.is_ok(),
            "Exactly one channel must reserve the last seat"
        );
        match (chat, web) {
            (Err(DbError::AirhopCapacityFull), Ok(_))
            | (Ok(_), Err(DbError::AirhopCapacityFull)) => {}
            other => panic!("Unexpected race outcome: {other:?}"),
        }
        assert_eq!(count(&f, "airhop_bookings").await, 1);
        assert_eq!(count(&f, "airhop_families").await, 1);
    }
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_verified_parent_reuses_only_their_own_child() {
    let f = Fixture::new().await;
    let reference = lesson(&f).await;
    let (turn, draft) = prepare(&f, reference).await;
    publish(&f, &turn, &draft, true).await;
    let event = inbound(&f, "Подтверждаю запись").await;
    let confirm = f.lease(&event).await;
    f.db.commit_airhop_booking_draft(&f.tenant, &commit_input(&f, &confirm, draft.version))
        .await
        .unwrap();
    // End the first turn; subsequent grants get the new scoped family, while
    // the current unverified grant never acquires family-reading privileges.
    let mut finished = draft.clone();
    finished.preview = Some("Запись подтверждена".into());
    publish(&f, &confirm, &finished, true).await;
    let child: Uuid = sqlx::query_scalar("SELECT id FROM airhop_children WHERE community_id=$1")
        .bind(f.tenant.community().as_uuid())
        .fetch_one(&f.db.pool)
        .await
        .unwrap();
    let reference2 = lesson(&f).await;
    let request = inbound(&f, "И ещё одно занятие, пожалуйста").await;
    let next = f.lease(&request).await;
    let mut fields = data(reference2);
    fields.child_id = Some(child);
    fields.parent_name = Some("Incorrect model guess".into());
    fields.parent_first_name = Some("Incorrect given name".into());
    fields.parent_last_name = Some("Incorrect surname".into());
    fields.phone = Some("+79990000999".into());
    fields.child_name = None;
    fields.child_birth_date = None;
    let ready =
        f.db.save_airhop_booking_draft(&f.tenant, &lease(&f, &next), draft.version, fields)
            .await
            .unwrap();
    assert_eq!(ready.data.parent_name.as_deref(), Some("Андрей Макеев"));
    assert_eq!(ready.data.parent_first_name.as_deref(), Some("Андрей"));
    assert_eq!(ready.data.parent_last_name.as_deref(), Some("Макеев"));
    assert_eq!(ready.data.phone.as_deref(), Some("+79990000123"));
    assert_eq!(ready.data.child_name.as_deref(), Some("Платон"));
    let foreign_reference = lesson(&f).await;
    let foreign = public_booking(&f, foreign_reference, 22, 22, "+79990000022")
        .await
        .unwrap();
    let mut forged = ready.data.clone();
    forged.child_id = Some(foreign.booking.child_id);
    assert!(matches!(
        f.db.save_airhop_booking_draft(&f.tenant, &lease(&f, &next), ready.version, forged)
            .await,
        Err(DbError::AirhopIdentityMismatch)
    ));
    publish(&f, &next, &ready, true).await;
    let yes = inbound(&f, "Подтверждаю запись").await;
    let next_confirm = f.lease(&yes).await;
    let mut input = commit_input(&f, &next_confirm, ready.version);
    input.command_digest = [82; 32];
    input.management_token_digest = [92; 32];
    let result =
        f.db.commit_airhop_booking_draft(&f.tenant, &input)
            .await
            .unwrap();
    assert_eq!(result.status, BookingStatus::Confirmed);
    let family: Uuid =
        sqlx::query_scalar("SELECT family_id FROM airhop_bookings WHERE community_id=$1 AND id=$2")
            .bind(f.tenant.community().as_uuid())
            .bind(result.booking_id)
            .fetch_one(&f.db.pool)
            .await
            .unwrap();
    assert_eq!(Some(family), next.turn.family_id);
    assert_eq!(count(&f, "airhop_children").await, 2);
    assert_eq!(count(&f, "airhop_families").await, 2);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_review_rejects_unrelated_yes_and_expired_consent() {
    for mode in ["changed_mind", "later_question", "expired"] {
        let f = Fixture::new().await;
        let reference = lesson(&f).await;
        let (turn, draft) = prepare(&f, reference).await;
        publish(&f, &turn, &draft, true).await;
        if mode != "expired" {
            let unrelated = inbound(&f, "Пока не записывайте").await;
            if mode == "later_question" {
                let next = f.lease(&unrelated).await;
                let mut question = draft.clone();
                question.preview = Some("Хотите узнать про другие занятия?".into());
                publish(&f, &next, &question, true).await;
            }
        }
        let yes = inbound(&f, "Да").await;
        let confirm = f.lease(&yes).await;
        if mode == "expired" {
            sqlx::query("UPDATE airhop_conversation_booking_drafts SET updated_at=now()-interval '25 hours' WHERE community_id=$1")
                .bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
            sqlx::query("UPDATE airhop_external_message_outbox SET created_at=now()-interval '25 hours',delivered_at=now()-interval '24 hours 55 minutes' WHERE community_id=$1")
                .bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
            sqlx::query("UPDATE events SET received_at=now()-interval '24 hours 50 minutes' WHERE community_id=$1 AND id=$2")
                .bind(f.tenant.community().as_uuid()).bind(yes.id.as_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
        }
        assert!(
            f.db.commit_airhop_booking_draft(&f.tenant, &commit_input(&f, &confirm, draft.version))
                .await
                .is_err(),
            "{mode}"
        );
        assert_eq!(count(&f, "airhop_bookings").await, 0, "{mode}");
    }
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn conversational_booking_summary_must_be_the_last_parent_facing_message() {
    let f = Fixture::new().await;
    let reference = lesson(&f).await;
    let (turn, draft) = prepare(&f, reference).await;
    let summary = f.event(&f.hermes, draft.preview.as_ref().unwrap(), vec![]);
    let question = f.event(&f.hermes, "Хотите узнать про другие занятия?", vec![]);
    f.db.commit_airhop_hermes_reply(
        &f.tenant,
        &CommitHermesReplyInput {
            turn_id: turn.turn.id,
            lease_token: turn.turn.lease_token,
            agent_pubkey: f.hermes.public_key().to_bytes(),
            outcome: "answered".into(),
            events: vec![summary.clone(), question.clone()],
        },
    )
    .await
    .unwrap();
    for event in [&summary, &question] {
        f.insert(event).await;
        sqlx::query("UPDATE airhop_external_message_outbox SET status='delivered',delivered_at=clock_timestamp() WHERE community_id=$1 AND buzz_event_id=$2")
            .bind(f.tenant.community().as_uuid()).bind(event.id.as_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    }
    let yes = inbound(&f, "Да").await;
    let confirm = f.lease(&yes).await;
    assert!(f
        .db
        .commit_airhop_booking_draft(&f.tenant, &commit_input(&f, &confirm, draft.version))
        .await
        .is_err());
    assert_eq!(count(&f, "airhop_bookings").await, 0);
}
