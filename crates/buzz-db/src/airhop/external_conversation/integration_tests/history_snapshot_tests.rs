use super::*;
use crate::airhop::agent_runtime::FinishHermesTurn;

async fn commit_reply(f: &Fixture, turn: &LeasedParentAgentTurn, text: &str) -> Event {
    let reply = f.event(&f.hermes, text, vec![]);
    f.db.commit_airhop_hermes_reply(
        &f.tenant,
        &CommitHermesReplyInput {
            turn_id: turn.turn.id,
            lease_token: turn.turn.lease_token,
            agent_pubkey: f.hermes.public_key().to_bytes(),
            outcome: "waiting_parent".into(),
            events: vec![reply.clone()],
        },
    )
    .await
    .unwrap();
    f.insert(&reply).await;
    reply
}

async fn deliver(f: &Fixture, reply: &Event) {
    sqlx::query("UPDATE airhop_external_message_outbox SET status='delivered', delivered_at=clock_timestamp() WHERE community_id=$1 AND buzz_event_id=$2")
        .bind(f.tenant.community().as_uuid()).bind(reply.id.as_bytes().as_slice())
        .execute(&f.db.pool).await.unwrap();
}

async fn history(f: &Fixture, turn: &LeasedParentAgentTurn) -> Value {
    f.db.get_airhop_parent_turn_history(
        &f.tenant,
        turn.turn.id,
        turn.turn.lease_token,
        f.hermes.public_key().to_bytes(),
    )
    .await
    .unwrap()
}

fn contains(history: &Value, event: &Event) -> bool {
    history["messages"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m["id"] == event.id.to_hex())
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn coalesced_inputs_cannot_replay_under_a_new_batch_id() {
    let f = Fixture::new().await;
    let first = f.event(&f.parent, "Лида", vec![]);
    f.insert(&first).await;
    let last = f.event(&f.parent, "ой, Путина", vec![]);
    f.insert(&last).await;
    let route =
        f.db.get_airhop_hermes_parent_batch_route(
            &f.tenant,
            &[*last.id.as_bytes(), *first.id.as_bytes()],
            f.hermes.public_key().to_bytes(),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(route.source_message_id, *last.id.as_bytes());
    let turn = f.lease(&last).await;
    let before = history(&f, &turn).await;
    assert!(contains(&before, &first));
    assert!(contains(&before, &last));
    commit_reply(&f, &turn, "Фамилию исправил. Как зовут ребёнка?").await;
    for event in [&first, &last] {
        let replay = LeaseParentAgentTurnInput {
            deployment_id: turn.deployment.id,
            channel_id: f.channel,
            conversation_id: f.conversation,
            cycle_id: turn.turn.cycle_id,
            input_batch_id: Uuid::new_v4(),
            source_message_id: *event.id.as_bytes(),
            family_id: None,
            representative_id: None,
            lease_seconds: 600,
        };
        assert!(matches!(
            f.db.lease_airhop_parent_agent_turn(&f.tenant, &replay)
                .await,
            Err(DbError::AirhopVersionConflict)
        ));
    }
    let next = f.event(&f.parent, "Мурил", vec![]);
    f.insert(&next).await;
    f.lease(&next).await;
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn reply_check_is_nonmutating_scoped_and_does_not_repair_committed_output() {
    let f = Fixture::new().await;
    let input = f.event(&f.parent, "Вопрос", vec![]);
    f.insert(&input).await;
    let turn = f.lease(&input).await;
    let check = || {
        f.db.airhop_parent_turn_needs_reply(
            &f.tenant,
            turn.turn.id,
            turn.turn.lease_token,
            f.hermes.public_key().to_bytes(),
        )
    };
    assert!(check().await.unwrap());
    assert!(check().await.unwrap());
    assert!(f
        .db
        .airhop_parent_turn_needs_reply(
            &f.tenant,
            turn.turn.id,
            Uuid::new_v4(),
            f.hermes.public_key().to_bytes()
        )
        .await
        .is_err());
    assert!(f
        .db
        .airhop_parent_turn_needs_reply(
            &f.tenant,
            turn.turn.id,
            turn.turn.lease_token,
            f.parent.public_key().to_bytes()
        )
        .await
        .is_err());
    let other = Fixture::new().await;
    assert!(f
        .db
        .airhop_parent_turn_needs_reply(
            &other.tenant,
            turn.turn.id,
            turn.turn.lease_token,
            f.hermes.public_key().to_bytes()
        )
        .await
        .is_err());
    commit_reply(&f, &turn, "Ответ").await;
    assert!(!check().await.unwrap());
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn queued_followup_sees_previous_reply_without_consuming_later_parent_input() {
    let f = Fixture::new().await;
    let first = f.event(&f.parent, "давайте на самое ближайшее", vec![]);
    f.insert(&first).await;
    let first_turn = f.lease(&first).await;
    let followup = f.event(&f.parent, "в субботу", vec![]);
    f.insert(&followup).await;
    let reply = commit_reply(
        &f,
        &first_turn,
        "В субботу в 11:00. Подскажите имя и телефон.",
    )
    .await;
    deliver(&f, &reply).await;
    // Received before the next lease, but outside its input batch.
    let queued_later = f.event(&f.parent, "Другой вопрос в следующем пакете", vec![]);
    f.insert(&queued_later).await;
    let next = f.lease(&followup).await;
    let future = f.event(&f.parent, "Сообщение после начала хода", vec![]);
    f.insert(&future).await;
    let result = history(&f, &next).await;
    assert!(
        contains(&result, &reply),
        "queued clarification lost the preceding delivered reply"
    );
    assert!(contains(&result, &first));
    assert!(contains(&result, &followup));
    assert!(!contains(&result, &queued_later));
    assert!(!contains(&result, &future));
    let last = result["messages"].as_array().unwrap().last().unwrap();
    assert_eq!(last["actor"], "hermes");
    assert_eq!(last["internal"], false);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn repeated_context_reads_do_not_advance_the_reply_snapshot() {
    let f = Fixture::new().await;
    let first = f.event(&f.parent, "Первый вопрос", vec![]);
    f.insert(&first).await;
    let first_turn = f.lease(&first).await;
    let followup = f.event(&f.parent, "Уточнение", vec![]);
    f.insert(&followup).await;
    let reply = commit_reply(&f, &first_turn, "Ответ, ожидающий доставки").await;
    let next = f.lease(&followup).await;
    let before = history(&f, &next).await;
    assert!(!contains(&before, &reply));
    deliver(&f, &reply).await;
    // Read-set writes change updated_at, not the immutable history snapshot.
    f.db.record_airhop_parent_agent_turn_read(
        &f.tenant,
        next.turn.id,
        next.turn.lease_token,
        f.hermes.public_key().to_bytes(),
        "get_turn_context",
        None,
    )
    .await
    .unwrap();
    assert_eq!(history(&f, &next).await, before);
    let replay =
        f.db.lease_airhop_parent_agent_turn(
            &f.tenant,
            &LeaseParentAgentTurnInput {
                deployment_id: next.deployment.id,
                channel_id: f.channel,
                conversation_id: f.conversation,
                cycle_id: next.turn.cycle_id,
                input_batch_id: next.turn.input_batch_id,
                source_message_id: *followup.id.as_bytes(),
                family_id: None,
                representative_id: None,
                lease_seconds: 600,
            },
        )
        .await
        .unwrap();
    assert_eq!(replay.turn.lease_token, next.turn.lease_token);
    assert_eq!(
        replay.turn.configuration_snapshot,
        next.turn.configuration_snapshot
    );
    assert_eq!(history(&f, &replay).await, before);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn late_delivery_does_not_relabel_internal_content_within_a_lease() {
    let f = Fixture::new().await;
    let first = f.event(&f.parent, "Первый вопрос", vec![]);
    f.insert(&first).await;
    let first_turn = f.lease(&first).await;
    let reply = commit_reply(&f, &first_turn, "Ожидает доставки").await;
    let followup = f.event(&f.parent, "Уточнение", vec![]);
    f.insert(&followup).await;
    let next = f.lease(&followup).await;
    let before = history(&f, &next).await;
    let message = before["messages"]
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["id"] == reply.id.to_hex())
        .unwrap();
    assert_eq!(message["internal"], true);
    deliver(&f, &reply).await;
    assert_eq!(history(&f, &next).await, before);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn legacy_lease_uses_started_at_without_a_schema_migration() {
    let f = Fixture::new().await;
    let first = f.event(&f.parent, "Первый вопрос", vec![]);
    f.insert(&first).await;
    let first_turn = f.lease(&first).await;
    let followup = f.event(&f.parent, "Уточнение", vec![]);
    f.insert(&followup).await;
    let reply = commit_reply(&f, &first_turn, "Уже доставлен").await;
    deliver(&f, &reply).await;
    let next = f.lease(&followup).await;
    sqlx::query("UPDATE airhop_hermes_turn_receipts SET configuration_snapshot=configuration_snapshot-'historySnapshotAt' WHERE community_id=$1 AND id=$2")
        .bind(f.tenant.community().as_uuid()).bind(next.turn.id)
        .execute(&f.db.pool).await.unwrap();
    assert!(contains(&history(&f, &next).await, &reply));
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn retry_refreshes_reply_snapshot_without_reauthoring_parent_input() {
    let f = Fixture::new().await;
    let first = f.event(&f.parent, "Первый вопрос", vec![]);
    f.insert(&first).await;
    let original = f.lease(&first).await;
    let started_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "SELECT started_at FROM airhop_hermes_turn_receipts WHERE community_id=$1 AND id=$2",
    )
    .bind(f.tenant.community().as_uuid())
    .bind(original.turn.id)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    let retry_input = LeaseParentAgentTurnInput {
        deployment_id: original.deployment.id,
        channel_id: f.channel,
        conversation_id: f.conversation,
        cycle_id: original.turn.cycle_id,
        input_batch_id: original.turn.input_batch_id,
        source_message_id: *first.id.as_bytes(),
        family_id: None,
        representative_id: None,
        lease_seconds: 600,
    };
    f.db.finish_airhop_parent_agent_turn(
        &f.tenant,
        original.turn.id,
        original.turn.lease_token,
        f.hermes.public_key().to_bytes(),
        &FinishHermesTurn::Failed {
            error_code: "runtime_finished_without_reply".into(),
        },
    )
    .await
    .unwrap();
    let later = f.event(&f.parent, "Следующий вопрос", vec![]);
    f.insert(&later).await;
    let later_turn = f.lease(&later).await;
    let reply = commit_reply(&f, &later_turn, "Уже отправленный ответ центра").await;
    deliver(&f, &reply).await;
    let retry =
        f.db.lease_airhop_parent_agent_turn(&f.tenant, &retry_input)
            .await
            .unwrap();
    let result = history(&f, &retry).await;
    assert!(contains(&result, &reply));
    assert!(!contains(&result, &later));
    assert_eq!(
        retry.turn.source_message_id,
        original.turn.source_message_id
    );
    let retry_started_at: chrono::DateTime<chrono::Utc> = sqlx::query_scalar(
        "SELECT started_at FROM airhop_hermes_turn_receipts WHERE community_id=$1 AND id=$2",
    )
    .bind(f.tenant.community().as_uuid())
    .bind(retry.turn.id)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(retry_started_at, started_at);
    assert_eq!(retry.turn.attempt, 2);
    assert_ne!(retry.turn.lease_token, original.turn.lease_token);
    let stale =
        f.db.get_airhop_parent_turn_history(
            &f.tenant,
            original.turn.id,
            original.turn.lease_token,
            f.hermes.public_key().to_bytes(),
        )
        .await
        .unwrap();
    assert_eq!(stale["messages"], json!([]));
}
