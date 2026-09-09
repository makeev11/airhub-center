use super::*;
use crate::airhop::agent_runtime::LeasedParentAgentTurn;
use crate::airhop::external_conversation::StaffControlIntent;

async fn lease(f: &Fixture, event: &Event) -> LeasedParentAgentTurn {
    let scope =
        f.db.get_airhop_hermes_parent_event_route(
            &f.tenant,
            *event.id.as_bytes(),
            f.agent.public_key().to_bytes(),
        )
        .await
        .unwrap()
        .unwrap();
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
    .unwrap()
}

async fn history_ids(f: &Fixture, turn: &LeasedParentAgentTurn) -> Vec<String> {
    f.db.get_airhop_parent_turn_history(
        &f.tenant,
        turn.turn.id,
        turn.turn.lease_token,
        f.agent.public_key().to_bytes(),
    )
    .await
    .unwrap()["messages"]
        .as_array()
        .unwrap()
        .iter()
        .map(|m| m["id"].as_str().unwrap().to_owned())
        .collect()
}

fn staff_command(
    f: &Fixture,
    route: &ResolvedConversationRoute,
    root: &Event,
    text: &str,
) -> Event {
    let base = f.event(route, Some(root), &f.owner, text);
    EventBuilder::new(Kind::Custom(9), text)
        .tags(base.tags)
        .tags([Tag::public_key(f.agent.public_key())])
        .sign_with_keys(&f.owner)
        .unwrap()
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn shared_history_never_reads_another_root_with_the_same_connector_identity() {
    let f = Fixture::new().await;
    let connection = f.connection(ConnectionRouting::default()).await;
    let other = f.route(connection.id, 71).await;
    let own = f.route(connection.id, 72).await;
    assert_eq!(own.channel_id, other.channel_id);
    let other_root = f.event(
        &other,
        None,
        &f.connector,
        "Другой ребёнок: закрытые данные",
    );
    f.insert(connection.id, &other, &other_root, None, Some(71))
        .await
        .unwrap();
    let note = f.event(
        &other,
        Some(&other_root),
        &f.owner,
        "Внутренняя заметка другой семьи",
    );
    f.insert(connection.id, &other, &note, Some(&other_root), None)
        .await
        .unwrap();
    let root = f.event(&own, None, &f.connector, "Хочу записаться");
    f.insert(connection.id, &own, &root, None, Some(72))
        .await
        .unwrap();
    let first = lease(&f, &root).await;
    assert_eq!(history_ids(&f, &first).await, vec![root.id.to_hex()]);
    let followup = f.event(&own, Some(&root), &f.connector, "В субботу");
    f.insert(connection.id, &own, &followup, Some(&root), Some(73))
        .await
        .unwrap();
    let reply = f.event(
        &own,
        Some(&root),
        &f.agent,
        "Суббота в 11:00. Как вас зовут?",
    );
    f.db.commit_airhop_hermes_reply(
        &f.tenant,
        &CommitHermesReplyInput {
            turn_id: first.turn.id,
            lease_token: first.turn.lease_token,
            agent_pubkey: f.agent.public_key().to_bytes(),
            outcome: "waiting_parent".into(),
            events: vec![reply.clone()],
        },
    )
    .await
    .unwrap();
    f.insert(connection.id, &own, &reply, Some(&root), None)
        .await
        .unwrap();
    sqlx::query("UPDATE airhop_external_message_outbox SET status='delivered', delivered_at=clock_timestamp() WHERE community_id=$1 AND buzz_event_id=$2")
        .bind(f.cid()).bind(reply.id.as_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    let later = f.event(&own, Some(&root), &f.connector, "Следующий вопрос");
    f.insert(connection.id, &own, &later, Some(&root), Some(74))
        .await
        .unwrap();
    let second = lease(&f, &followup).await;
    let ids = history_ids(&f, &second).await;
    assert_eq!(
        ids,
        vec![root.id.to_hex(), followup.id.to_hex(), reply.id.to_hex()]
    );
    assert!(!ids.contains(&other_root.id.to_hex()));
    assert!(!ids.contains(&note.id.to_hex()));
    assert!(!ids.contains(&later.id.to_hex()));
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn shared_staff_classification_rejects_mixed_batches_but_ignores_other_thread_staff() {
    let f = Fixture::new().await;
    let connection = f.connection(ConnectionRouting::default()).await;
    let own = f.route(connection.id, 81).await;
    let other = f.route(connection.id, 82).await;
    let root = f.event(&own, None, &f.connector, "Первый клиент");
    let other_root = f.event(&other, None, &f.connector, "Второй клиент");
    f.insert(connection.id, &own, &root, None, Some(81))
        .await
        .unwrap();
    f.insert(connection.id, &other, &other_root, None, Some(82))
        .await
        .unwrap();
    let command = staff_command(
        &f,
        &own,
        &root,
        "@Гермес por favor assuma o atendimento agora",
    );
    f.insert(connection.id, &own, &command, Some(&root), None)
        .await
        .unwrap();
    let other_staff = f.event(
        &other,
        Some(&other_root),
        &f.owner,
        "Я сам отвечу второму клиенту",
    );
    f.insert(connection.id, &other, &other_staff, Some(&other_root), None)
        .await
        .unwrap();
    let parent = f.event(&own, Some(&root), &f.connector, "Уточнение после передачи");
    f.insert(connection.id, &own, &parent, Some(&root), Some(83))
        .await
        .unwrap();
    let mixed = [*other_root.id.as_bytes(), *command.id.as_bytes()];
    assert!(f
        .db
        .resolve_airhop_staff_control_batch(
            &f.tenant,
            &mixed,
            f.agent.public_key().to_bytes(),
            None
        )
        .await
        .unwrap()
        .is_none());
    let batch = [*parent.id.as_bytes(), *command.id.as_bytes()];
    let candidate =
        f.db.resolve_airhop_staff_control_batch(
            &f.tenant,
            &batch,
            f.agent.public_key().to_bytes(),
            None,
        )
        .await
        .unwrap()
        .unwrap();
    assert_eq!(candidate.event_id, command.id.to_hex());
    f.db.resolve_airhop_staff_control_batch(
        &f.tenant,
        &mixed,
        f.agent.public_key().to_bytes(),
        Some((
            *command.id.as_bytes(),
            candidate.control_version,
            StaffControlIntent::Resume,
        )),
    )
    .await
    .unwrap();
    assert_eq!(f.row(own.conversation_id).await["owner"], "human");
    f.db.resolve_airhop_staff_control_batch(
        &f.tenant,
        &batch,
        f.agent.public_key().to_bytes(),
        Some((
            *command.id.as_bytes(),
            candidate.control_version,
            StaffControlIntent::Resume,
        )),
    )
    .await
    .unwrap();
    assert_eq!(f.row(own.conversation_id).await["owner"], "hermes");
    assert_eq!(f.row(other.conversation_id).await["owner"], "human");
    let turn = lease(&f, &parent).await;
    let ids = history_ids(&f, &turn).await;
    assert!(ids.contains(&command.id.to_hex()));
    assert!(ids.contains(&parent.id.to_hex()));
    assert!(!ids.contains(&other_root.id.to_hex()));
    assert!(!ids.contains(&other_staff.id.to_hex()));
}
