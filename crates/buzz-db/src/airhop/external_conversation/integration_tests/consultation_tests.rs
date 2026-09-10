use super::*;

async fn report(f: &Fixture) -> serde_json::Value {
    f.db.get_airhop_consultation_analytics(&f.tenant, &f.owner.public_key().to_bytes(), 30, false)
        .await
        .unwrap()
}
fn progress(
    f: &Fixture,
    turn: &LeasedParentAgentTurn,
    value: serde_json::Value,
) -> CommitHermesReplyInput {
    let event = f.event(
        &f.hermes,
        "Какое время вам удобно?",
        vec![
            Tag::parse(["airhop-hermes-turn", &turn.turn.id.to_string()]).unwrap(),
            Tag::parse(["airhop-consultation", &value.to_string()]).unwrap(),
        ],
    );
    CommitHermesReplyInput {
        turn_id: turn.turn.id,
        lease_token: turn.turn.lease_token,
        agent_pubkey: f.hermes.public_key().to_bytes(),
        outcome: "answered".into(),
        events: vec![event],
    }
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn consultation_tracks_delivery_replies_silence_and_membership_without_duplicates() {
    let f = Fixture::new_threaded().await;
    let source = f.event(&f.parent, "Хочу подобрать занятие", vec![]);
    f.insert(&source).await;
    let turn = f.lease(&source).await;
    let input = progress(&f, &turn, json!({"purpose":"booking","waitingFor":"time"}));
    f.db.commit_airhop_hermes_reply(&f.tenant, &input)
        .await
        .unwrap();
    f.db.commit_airhop_hermes_reply(&f.tenant, &input)
        .await
        .unwrap();
    let r = report(&f).await;
    assert_eq!(r["summary"]["started"], 1);
    assert_eq!(r["summary"]["delivery"], 1);
    assert_eq!(
        r["questions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|q| q["asked"].as_u64().unwrap())
            .sum::<u64>(),
        0
    );
    f.insert(&input.events[0]).await;
    sqlx::query("UPDATE airhop_external_message_outbox SET status='delivered',delivered_at=clock_timestamp() WHERE community_id=$1 AND buzz_event_id=$2")
        .bind(f.tenant.community().as_uuid()).bind(input.events[0].id.as_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    let r = report(&f).await;
    assert_eq!(r["summary"]["waiting"], 1);
    assert_eq!(
        r["items"][0]["rootEventId"],
        f.root.as_ref().unwrap().id.to_hex()
    );
    sqlx::query("UPDATE airhop_gateway_inbound_receipts SET received_at=now()-interval '73 hours' WHERE community_id=$1")
        .bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
    sqlx::query("UPDATE airhop_consultations SET started_at=now()-interval '72 hours' WHERE community_id=$1")
        .bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
    sqlx::query("UPDATE airhop_external_message_outbox SET created_at=now()-interval '71 hours',delivered_at=now()-interval '49 hours' WHERE community_id=$1")
        .bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
    assert_eq!(report(&f).await["summary"]["quiet"], 1);
    assert_eq!(
        f.db.get_airhop_consultation_analytics(
            &f.tenant,
            &f.owner.public_key().to_bytes(),
            1,
            false
        )
        .await
        .unwrap()["summary"]["started"],
        0
    );
    assert!(f
        .db
        .get_airhop_consultation_analytics(&f.tenant, &f.owner.public_key().to_bytes(), 0, false)
        .await
        .is_err());

    let reply = f.event(&f.parent, "В субботу", vec![]);
    f.insert(&reply).await;
    let r = report(&f).await;
    assert_eq!(r["summary"]["quiet"], 0);
    assert_eq!(r["summary"]["agentWaiting"], 1);
    let time = r["questions"]
        .as_array()
        .unwrap()
        .iter()
        .find(|q| q["key"] == "time")
        .unwrap();
    assert_eq!(time["asked"], 1);
    assert_eq!(time["answered"], 1);
    sqlx::query("UPDATE airhop_external_conversations SET owner='human',hermes_paused=true WHERE community_id=$1 AND id=$2")
        .bind(f.tenant.community().as_uuid()).bind(f.conversation).execute(&f.db.pool).await.unwrap();
    assert_eq!(report(&f).await["summary"]["withStaff"], 1);
    let stranger = Keys::generate();
    let hidden = f
        .db
        .get_airhop_consultation_analytics(&f.tenant, &stranger.public_key().to_bytes(), 30, false)
        .await
        .unwrap();
    assert_eq!(hidden["summary"]["started"], 0);
    assert_eq!(hidden["items"], json!([]));
    sqlx::query("UPDATE channel_members SET removed_at=now() WHERE community_id=$1 AND pubkey=$2")
        .bind(f.tenant.community().as_uuid())
        .bind(f.owner.public_key().to_bytes().as_slice())
        .execute(&f.db.pool)
        .await
        .unwrap();
    assert_eq!(report(&f).await["summary"]["started"], 0);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn consultation_requires_refusal_evidence_and_starts_a_new_enquiry_after_closure() {
    let f = Fixture::new().await;
    let source = f.event(&f.parent, "Спасибо, записываться не будем", vec![]);
    f.insert(&source).await;
    let turn = f.lease(&source).await;
    let false_confirmation = progress(
        &f,
        &turn,
        json!({"purpose":"booking","waitingFor":"confirmation"}),
    );
    assert!(f
        .db
        .commit_airhop_hermes_reply(&f.tenant, &false_confirmation)
        .await
        .is_err());
    let invalid = progress(
        &f,
        &turn,
        json!({"purpose":"booking","declinedQuote":"Это придуманный отказ"}),
    );
    assert!(f
        .db
        .commit_airhop_hermes_reply(&f.tenant, &invalid)
        .await
        .is_err());
    assert_eq!(report(&f).await["summary"]["started"], 0);
    let valid = progress(
        &f,
        &turn,
        json!({"purpose":"booking","declinedQuote":"записываться не будем"}),
    );
    f.db.commit_airhop_hermes_reply(&f.tenant, &valid)
        .await
        .unwrap();
    assert_eq!(report(&f).await["summary"]["declined"], 1);
    let source = f.event(&f.parent, "Передумали, подберите занятие", vec![]);
    f.insert(&source).await;
    let turn = f.lease(&source).await;
    let input = progress(
        &f,
        &turn,
        json!({"purpose":"booking","waitingFor":"activity"}),
    );
    f.db.commit_airhop_hermes_reply(&f.tenant, &input)
        .await
        .unwrap();
    assert_eq!(report(&f).await["summary"]["started"], 2);
    let other = Fixture::new().await;
    assert_eq!(report(&other).await["summary"]["started"], 0);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn consultation_excludes_support_and_does_not_invent_historical_steps() {
    let f = Fixture::new().await;
    let source = f.event(&f.parent, "Где оставить коляску?", vec![]);
    f.insert(&source).await;
    let turn = f.lease(&source).await;
    let input = progress(&f, &turn, json!({"purpose":"support","waitingFor":"other"}));
    f.db.commit_airhop_hermes_reply(&f.tenant, &input)
        .await
        .unwrap();
    let r = report(&f).await;
    assert_eq!(r["summary"]["started"], 0);
    assert_eq!(r["untrackedConversations"], 1);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn consultation_versions_freeze_server_configuration_and_exclude_mixed_exposure() {
    let f = Fixture::new().await;
    let source = f.event(&f.parent, "Хочу записаться", vec![]);
    f.insert(&source).await;
    let turn = f.lease(&source).await;
    let input = progress(&f, &turn, json!({"purpose":"booking","waitingFor":"time"}));
    f.db.commit_airhop_hermes_reply(&f.tenant, &input)
        .await
        .unwrap();
    f.db.commit_airhop_hermes_reply(&f.tenant, &input)
        .await
        .unwrap();
    let initial = report(&f).await;
    assert_eq!(initial["learning"]["pending"], 1);
    assert_eq!(initial["learning"]["eligible"], 0);
    assert_eq!(initial["learning"]["unattributed"], 0);
    assert_eq!(initial["learning"]["versions"].as_array().unwrap().len(), 1);
    assert_eq!(
        initial["learning"]["versions"][0]["configuration"]["personaRevision"],
        turn.turn.configuration_snapshot["personaRevision"]
    );
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM airhop_consultation_exposures WHERE community_id=$1",
    )
    .bind(f.tenant.community().as_uuid())
    .fetch_one(&f.db.pool)
    .await
    .unwrap();
    assert_eq!(count, 1);
    // Updating desired state must not relabel the historical exposure.
    sqlx::query("UPDATE airhop_agent_deployments SET persona_revision='next-persona',version=version+1 WHERE community_id=$1")
        .bind(f.tenant.community().as_uuid()).execute(&f.db.pool).await.unwrap();
    assert_eq!(
        report(&f).await["learning"]["versions"],
        initial["learning"]["versions"]
    );
    let next = f.event(&f.parent, "Можно вечером?", vec![]);
    f.insert(&next).await;
    let turn = f.lease(&next).await;
    // Even an untagged response participates in an already tracked enquiry.
    let mut input = progress(&f, &turn, json!({"purpose":"information"}));
    input.events = vec![f.event(
        &f.hermes,
        "Сейчас проверю",
        vec![Tag::parse(["airhop-hermes-turn", &turn.turn.id.to_string()]).unwrap()],
    )];
    f.db.commit_airhop_hermes_reply(&f.tenant, &input)
        .await
        .unwrap();
    let mixed = report(&f).await;
    assert_eq!(mixed["learning"]["mixed"], 1);
    assert_eq!(mixed["learning"]["versions"], json!([]));
    assert_eq!(mixed["learning"]["pending"], 1);
    // Legacy enquiries are unknown, not attributed to whichever version replies next.
    sqlx::query(
        "UPDATE airhop_consultations SET version_tracking_started=false WHERE community_id=$1",
    )
    .bind(f.tenant.community().as_uuid())
    .execute(&f.db.pool)
    .await
    .unwrap();
    let legacy = report(&f).await;
    assert_eq!(legacy["learning"]["unattributed"], 1);
    assert_eq!(legacy["learning"]["mixed"], 0);
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn consultation_learning_requires_seven_days_and_registered_analyst_gets_only_aggregates() {
    let f = Fixture::new().await;
    let source = f.event(&f.parent, "Хочу записаться", vec![]);
    f.insert(&source).await;
    let turn = f.lease(&source).await;
    f.db.commit_airhop_hermes_reply(
        &f.tenant,
        &progress(&f, &turn, json!({"purpose":"booking","waitingFor":"age"})),
    )
    .await
    .unwrap();
    let community = *f.tenant.community().as_uuid();
    sqlx::query("UPDATE airhop_consultations SET started_at=now()-interval '6 days 23 hours' WHERE community_id=$1")
        .bind(community).execute(&f.db.pool).await.unwrap();
    assert_eq!(report(&f).await["learning"]["eligible"], 0);
    sqlx::query(
        "UPDATE airhop_consultations SET started_at=now()-interval '8 days' WHERE community_id=$1",
    )
    .bind(community)
    .execute(&f.db.pool)
    .await
    .unwrap();
    sqlx::query("UPDATE airhop_consultation_exposures SET recorded_at=now()-interval '8 days'+interval '1 minute' WHERE community_id=$1")
        .bind(community).execute(&f.db.pool).await.unwrap();
    let mature = report(&f).await;
    assert_eq!(mature["learning"]["eligible"], 1);
    assert_eq!(mature["learning"]["pending"], 0);
    assert_eq!(mature["learning"]["booked"], 0);
    assert_eq!(mature["learning"]["versions"][0]["eligible"], 1);
    let analyst = Keys::generate();
    let other = Keys::generate();
    sqlx::query("INSERT INTO airhop_welcome_teams(community_id,organization_id,channel_id,locale,fizz_pubkey,administrator_pubkey,analyst_pubkey,content_marketer_pubkey,registered_by_pubkey) SELECT community_id,id,$2,'ru-RU',$3,$4,$5,$6,$3 FROM airhop_organizations WHERE community_id=$1")
        .bind(community).bind(f.channel).bind(f.owner.public_key().to_bytes().as_slice()).bind(f.hermes.public_key().to_bytes().as_slice()).bind(analyst.public_key().to_bytes().as_slice()).bind(other.public_key().to_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    let aggregate = f
        .db
        .get_airhop_consultation_analytics(&f.tenant, &analyst.public_key().to_bytes(), 30, false)
        .await
        .unwrap();
    assert_eq!(aggregate["summary"]["started"], 1);
    assert_eq!(aggregate["learning"]["scope"], "organization_aggregate");
    assert_eq!(aggregate["learning"]["eligible"], 1);
    assert_eq!(aggregate["items"], json!([]));
    assert_eq!(aggregate["itemsTruncated"], false);
    assert!(!aggregate.to_string().contains(&f.conversation.to_string()));
    let marketer = f
        .db
        .get_airhop_consultation_analytics(&f.tenant, &other.public_key().to_bytes(), 30, false)
        .await
        .unwrap();
    assert_eq!(marketer["summary"]["started"], 0);
    sqlx::query("UPDATE airhop_welcome_teams SET analyst_pubkey=$2 WHERE community_id=$1")
        .bind(community)
        .bind(Keys::generate().public_key().to_bytes().as_slice())
        .execute(&f.db.pool)
        .await
        .unwrap();
    let revoked = f
        .db
        .get_airhop_consultation_analytics(&f.tenant, &analyst.public_key().to_bytes(), 30, false)
        .await
        .unwrap();
    assert_eq!(revoked["summary"]["started"], 0);
    assert_eq!(revoked["items"], json!([]));
}
