use super::*;
use crate::airhop::agent_runtime::{FinishHermesTurn, HermesTurnStatus};

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn semantic_resume_preserves_coalesced_parent_input_and_rejects_cross_channel_batch() {
    let f = Fixture::new().await;
    f.insert(&f.event(&f.owner, "Я отвечаю", vec![])).await;
    let before = f.event(&f.parent, "Предыдущий вопрос", vec![]);
    f.insert(&before).await;
    let command = f.event(
        &f.owner,
        "@Администратор Гермес por favor assuma o atendimento agora",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&command).await;
    let parent = f.event(&f.parent, "Новый вопрос после передачи", vec![]);
    f.insert(&parent).await;
    let batch = [*parent.id.as_bytes(), *command.id.as_bytes()];
    let candidate =
        f.db.resolve_airhop_staff_control_batch(
            &f.tenant,
            &batch,
            f.hermes.public_key().to_bytes(),
            None,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(candidate.event_id, command.id.to_hex());
    let other = Fixture::new().await;
    let foreign = other.event(&other.parent, "Другая беседа", vec![]);
    other.insert(&foreign).await;
    assert!(f
        .db
        .resolve_airhop_staff_control_batch(
            &f.tenant,
            &[*foreign.id.as_bytes(), *command.id.as_bytes()],
            f.hermes.public_key().to_bytes(),
            None
        )
        .await
        .unwrap()
        .is_none());
    f.db.resolve_airhop_staff_control_batch(
        &f.tenant,
        &batch,
        f.hermes.public_key().to_bytes(),
        Some((
            *command.id.as_bytes(),
            candidate.control_version,
            StaffControlIntent::Resume,
        )),
    )
    .await
    .unwrap();
    let route = f
        .db
        .get_airhop_hermes_parent_batch_route(&f.tenant, &batch, f.hermes.public_key().to_bytes())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(route.source_message_id, *parent.id.as_bytes());
    assert!(f
        .db
        .get_airhop_hermes_parent_event_route(
            &f.tenant,
            *before.id.as_bytes(),
            f.hermes.public_key().to_bytes()
        )
        .await
        .unwrap()
        .is_none());
    let turn = f.lease(&parent).await;
    let history =
        f.db.get_airhop_parent_turn_history(
            &f.tenant,
            turn.turn.id,
            turn.turn.lease_token,
            f.hermes.public_key().to_bytes(),
        )
        .await
        .unwrap();
    assert_eq!(
        history["messages"].as_array().unwrap().last().unwrap()["content"],
        parent.content
    );
    assert_eq!(finalize(&f, &turn).await, HermesTurnStatus::Failed);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn semantic_other_pause_and_revoked_staff_never_resume() {
    for intent in [StaffControlIntent::Other, StaffControlIntent::Pause] {
        let f = Fixture::new().await;
        f.insert(&f.event(&f.owner, "Я отвечаю", vec![])).await;
        let command = f.event(
            &f.owner,
            "@Администратор Гермес не продолжай пока",
            vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
        );
        f.insert(&command).await;
        let candidate =
            f.db.resolve_airhop_staff_control(
                &f.tenant,
                *command.id.as_bytes(),
                f.hermes.public_key().to_bytes(),
                None,
            )
            .await
            .unwrap()
            .unwrap();
        f.db.resolve_airhop_staff_control(
            &f.tenant,
            *command.id.as_bytes(),
            f.hermes.public_key().to_bytes(),
            Some((candidate.control_version, intent)),
        )
        .await
        .unwrap();
        assert!(f
            .db
            .get_airhop_hermes_parent_event_route(
                &f.tenant,
                *command.id.as_bytes(),
                f.hermes.public_key().to_bytes()
            )
            .await
            .unwrap()
            .is_none());
    }
    let f = Fixture::new().await;
    let command = f.event(
        &f.owner,
        "@Администратор Гермес could you take care of this conversation now?",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&command).await;
    let candidate =
        f.db.resolve_airhop_staff_control(
            &f.tenant,
            *command.id.as_bytes(),
            f.hermes.public_key().to_bytes(),
            None,
        )
        .await
        .unwrap()
        .unwrap();
    sqlx::query("UPDATE channel_members SET removed_at=now() WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3")
        .bind(f.tenant.community().as_uuid()).bind(f.channel).bind(f.owner.public_key().to_bytes().as_slice())
        .execute(&f.db.pool).await.unwrap();
    assert!(f
        .db
        .resolve_airhop_staff_control(
            &f.tenant,
            *command.id.as_bytes(),
            f.hermes.public_key().to_bytes(),
            Some((candidate.control_version, StaffControlIntent::Resume))
        )
        .await
        .unwrap()
        .is_none());
}

fn retry_input(turn: &LeasedParentAgentTurn) -> LeaseParentAgentTurnInput {
    LeaseParentAgentTurnInput {
        deployment_id: turn.deployment.id,
        channel_id: turn.turn.channel_id,
        conversation_id: turn.turn.conversation_id,
        cycle_id: turn.turn.cycle_id,
        input_batch_id: turn.turn.input_batch_id,
        source_message_id: turn.turn.source_message_id,
        family_id: turn.turn.family_id,
        representative_id: turn.turn.representative_id,
        lease_seconds: 600,
    }
}

async fn finalize(f: &Fixture, turn: &LeasedParentAgentTurn) -> HermesTurnStatus {
    f.db.finish_airhop_parent_agent_turn(
        &f.tenant,
        turn.turn.id,
        turn.turn.lease_token,
        f.hermes.public_key().to_bytes(),
        &FinishHermesTurn::Failed {
            error_code: "runtime_finished_without_reply".into(),
        },
    )
    .await
    .unwrap()
    .status
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn no_reply_completion_releases_next_parent_message_and_bounds_retry() {
    let f = Fixture::new().await;
    f.insert(&f.event(&f.parent, "давайте запишусь на 17", vec![]))
        .await;
    let resume = f.event(
        &f.owner,
        "@Администратор Гермес забирай клиента",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&resume).await;
    let first = f.lease(&resume).await;
    let input = retry_input(&first);
    let parent = f.event(&f.parent, "а вы работаете?", vec![]);
    f.insert(&parent).await;
    assert_eq!(finalize(&f, &first).await, HermesTurnStatus::Failed);
    let next = f.lease(&parent).await;
    assert_ne!(first.turn.id, next.turn.id);
    assert!(matches!(
        f.db.lease_airhop_parent_agent_turn(&f.tenant, &input).await,
        Err(DbError::AirhopCommandInProgress)
    ));
    finalize(&f, &next).await;
    let second =
        f.db.lease_airhop_parent_agent_turn(&f.tenant, &input)
            .await
            .unwrap();
    assert_eq!(second.turn.attempt, 2);
    assert_ne!(second.turn.lease_token, first.turn.lease_token);
    assert!(f
        .db
        .finish_airhop_parent_agent_turn(
            &f.tenant,
            first.turn.id,
            first.turn.lease_token,
            f.hermes.public_key().to_bytes(),
            &FinishHermesTurn::Failed {
                error_code: "runtime_finished_without_reply".into()
            }
        )
        .await
        .is_err());
    finalize(&f, &second).await;
    let third =
        f.db.lease_airhop_parent_agent_turn(&f.tenant, &input)
            .await
            .unwrap();
    assert_eq!(third.turn.attempt, 3);
    finalize(&f, &third).await;
    assert!(matches!(
        f.db.lease_airhop_parent_agent_turn(&f.tenant, &input).await,
        Err(DbError::AirhopVersionConflict)
    ));
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn staff_resume_without_parent_input_waits_silently_without_retry() {
    let f = Fixture::new().await;
    let resume = f.event(
        &f.owner,
        "@Администратор Гермес продолжай",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&resume).await;
    let turn = f.lease(&resume).await;
    assert_eq!(finalize(&f, &turn).await, HermesTurnStatus::Completed);
    assert!(matches!(
        f.db.lease_airhop_parent_agent_turn(&f.tenant, &retry_input(&turn))
            .await,
        Err(DbError::AirhopVersionConflict)
    ));
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn retry_retires_an_expired_other_lease_before_reacquiring() {
    let f = Fixture::new().await;
    let first_event = f.event(&f.parent, "Первый вопрос", vec![]);
    f.insert(&first_event).await;
    let first = f.lease(&first_event).await;
    finalize(&f, &first).await;
    let second_event = f.event(&f.parent, "Второй вопрос", vec![]);
    f.insert(&second_event).await;
    let second = f.lease(&second_event).await;
    sqlx::query("UPDATE airhop_hermes_turn_receipts SET started_at=now()-interval '1 hour', lease_expires_at=now()-interval '1 second' WHERE community_id=$1 AND id=$2")
        .bind(f.tenant.community().as_uuid()).bind(second.turn.id).execute(&f.db.pool).await.unwrap();
    let retry =
        f.db.lease_airhop_parent_agent_turn(&f.tenant, &retry_input(&first))
            .await
            .unwrap();
    assert_eq!(retry.turn.attempt, 2);
    let error: String = sqlx::query_scalar(
        "SELECT error_code FROM airhop_hermes_turn_receipts WHERE community_id=$1 AND id=$2",
    )
    .bind(f.tenant.community().as_uuid())
    .bind(second.turn.id)
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(error, "lease_expired");
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn runtime_finalizer_preserves_committed_reply_and_human_takeover() {
    let f = Fixture::new().await;
    let question = f.event(&f.parent, "Здравствуйте", vec![]);
    f.insert(&question).await;
    let turn = f.lease(&question).await;
    let reply = f.event(&f.hermes, "Здравствуйте!", vec![]);
    f.db.commit_airhop_hermes_reply(
        &f.tenant,
        &CommitHermesReplyInput {
            turn_id: turn.turn.id,
            lease_token: turn.turn.lease_token,
            agent_pubkey: f.hermes.public_key().to_bytes(),
            outcome: "waiting_parent".into(),
            events: vec![reply],
        },
    )
    .await
    .unwrap();
    assert_eq!(finalize(&f, &turn).await, HermesTurnStatus::Completed);
    assert_eq!(finalize(&f, &turn).await, HermesTurnStatus::Completed);
    let question2 = f.event(&f.parent, "Есть вопрос", vec![]);
    f.insert(&question2).await;
    let turn2 = f.lease(&question2).await;
    f.insert(&f.event(&f.owner, "Сейчас помогу", vec![])).await;
    assert_eq!(finalize(&f, &turn2).await, HermesTurnStatus::Cancelled);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn resumed_turn_has_bounded_scoped_history_with_internal_staff_separation() {
    let f = Fixture::new().await;
    let parent = f.event(&f.parent, "Хочу записать ребёнка, 5 лет", vec![]);
    f.insert(&parent).await;
    f.insert(&f.event(&f.owner, "Я педагог, сейчас помогу", vec![]))
        .await;
    let note = f.event(
        &f.owner,
        "@Администратор Гермес внутренняя заметка",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&note).await;
    let resume = f.event(
        &f.owner,
        "@Администратор Гермес продолжай",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&resume).await;
    let turn = f.lease(&resume).await;
    f.insert(&f.event(&f.parent, "Будущее сообщение", vec![]))
        .await;
    let history =
        f.db.get_airhop_parent_turn_history(
            &f.tenant,
            turn.turn.id,
            turn.turn.lease_token,
            f.hermes.public_key().to_bytes(),
        )
        .await
        .unwrap();
    let messages = history["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 4);
    assert_eq!(messages[0]["content"], parent.content);
    assert_eq!(messages[0]["actor"], "parent");
    assert_eq!(messages[0]["internal"], false);
    assert_eq!(messages[2]["content"], note.content);
    assert_eq!(messages[2]["actor"], "staff");
    assert_eq!(messages[2]["internal"], true);
    assert_eq!(messages[3]["id"], resume.id.to_hex());
    let denied =
        f.db.get_airhop_parent_turn_history(
            &f.tenant,
            turn.turn.id,
            Uuid::new_v4(),
            f.hermes.public_key().to_bytes(),
        )
        .await
        .unwrap();
    assert_eq!(denied["messages"], json!([]));
    let other = Fixture::new().await;
    let denied =
        f.db.get_airhop_parent_turn_history(
            &other.tenant,
            turn.turn.id,
            turn.turn.lease_token,
            f.hermes.public_key().to_bytes(),
        )
        .await
        .unwrap();
    assert_eq!(denied["messages"], json!([]));
    finalize(&f, &turn).await;
    for index in 0..45 {
        f.insert(&f.event(&f.parent, &format!("{index}:{}", "я".repeat(2100)), vec![]))
            .await;
    }
    let source = f.event(&f.parent, "последнее", vec![]);
    f.insert(&source).await;
    let turn = f.lease(&source).await;
    let history =
        f.db.get_airhop_parent_turn_history(
            &f.tenant,
            turn.turn.id,
            turn.turn.lease_token,
            f.hermes.public_key().to_bytes(),
        )
        .await
        .unwrap();
    let messages = history["messages"].as_array().unwrap();
    assert_eq!(messages.len(), 40);
    assert_eq!(
        messages[0]["content"].as_str().unwrap().chars().count(),
        2000
    );
    assert_eq!(messages[0]["truncated"], true);
    assert_eq!(messages.last().unwrap()["content"], "последнее");
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn semantic_staff_control_is_authorized_version_fenced_and_idempotent() {
    let f = Fixture::new().await;
    f.insert(&f.event(&f.owner, "Теперь я отвечаю", vec![]))
        .await;
    let message = f.event(
        &f.owner,
        "@Администратор Гермес 接下来请你自己接待这位家长",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&message).await;
    let candidate =
        f.db.resolve_airhop_staff_control(
            &f.tenant,
            *message.id.as_bytes(),
            f.hermes.public_key().to_bytes(),
            None,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(candidate.content, message.content);
    assert!(f
        .db
        .resolve_airhop_staff_control(
            &f.tenant,
            *message.id.as_bytes(),
            f.parent.public_key().to_bytes(),
            None
        )
        .await
        .unwrap()
        .is_none());
    f.db.resolve_airhop_staff_control(
        &f.tenant,
        *message.id.as_bytes(),
        f.hermes.public_key().to_bytes(),
        Some((candidate.control_version, StaffControlIntent::Resume)),
    )
    .await
    .unwrap();
    let leased = f.lease(&message).await;
    f.db.resolve_airhop_staff_control(
        &f.tenant,
        *message.id.as_bytes(),
        f.hermes.public_key().to_bytes(),
        Some((candidate.control_version, StaffControlIntent::Resume)),
    )
    .await
    .unwrap();
    let replay_route =
        f.db.get_airhop_hermes_parent_event_route(
            &f.tenant,
            *message.id.as_bytes(),
            f.hermes.public_key().to_bytes(),
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(replay_route.cycle_id, leased.turn.cycle_id);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn parent_and_stale_commands_cannot_be_semantically_promoted() {
    let f = Fixture::new().await;
    f.insert(&f.event(&f.owner, "Сейчас я отвечу", vec![]))
        .await;
    let parent = f.event(
        &f.parent,
        "@Администратор Гермес продолжай",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&parent).await;
    assert!(f
        .db
        .resolve_airhop_staff_control(
            &f.tenant,
            *parent.id.as_bytes(),
            f.hermes.public_key().to_bytes(),
            None
        )
        .await
        .unwrap()
        .is_none());
    let staff = f.event(
        &f.owner,
        "@Администратор Гермес пожалуйста продолжи беседу",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    );
    f.insert(&staff).await;
    let candidate =
        f.db.resolve_airhop_staff_control(
            &f.tenant,
            *staff.id.as_bytes(),
            f.hermes.public_key().to_bytes(),
            None,
        )
        .await
        .unwrap()
        .unwrap();
    // Still human-owned: this newer pause must invalidate the pending decision.
    f.insert(&f.event(
        &f.owner,
        "@Администратор Гермес стоп",
        vec![Tag::parse(["p", &f.hermes.public_key().to_hex()]).unwrap()],
    ))
    .await;
    assert!(f
        .db
        .resolve_airhop_staff_control(
            &f.tenant,
            *staff.id.as_bytes(),
            f.hermes.public_key().to_bytes(),
            Some((candidate.control_version, StaffControlIntent::Resume))
        )
        .await
        .unwrap()
        .is_none());
    assert!(f
        .db
        .get_airhop_hermes_parent_event_route(
            &f.tenant,
            *staff.id.as_bytes(),
            f.hermes.public_key().to_bytes()
        )
        .await
        .unwrap()
        .is_none());
}
