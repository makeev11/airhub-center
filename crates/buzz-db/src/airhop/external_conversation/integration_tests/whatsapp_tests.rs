use super::*;
use crate::airhop::channel_gateway::{ExternalDeliveryAckState, ExternalDeliveryCompletion};

async fn whatsapp() -> Fixture {
    let f = Fixture::new().await;
    sqlx::query("UPDATE airhop_channel_connections SET provider='whatsapp_cloud' WHERE community_id=$1 AND id=$2").bind(f.tenant.community().as_uuid()).bind(f.connection).execute(&f.db.pool).await.unwrap();
    sqlx::query("UPDATE airhop_external_conversation_routes SET provider_chat_id='5511999990000' WHERE community_id=$1 AND conversation_id=$2").bind(f.tenant.community().as_uuid()).bind(f.conversation).execute(&f.db.pool).await.unwrap();
    f
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn whatsapp_acceptance_webhooks_replay_order_and_connector_fences() {
    let f = whatsapp().await;
    let reply = f.event(&f.owner, "Ответ сотрудника", vec![]);
    f.insert(&reply).await;
    let jobs =
        f.db.claim_airhop_external_messages(
            &f.tenant,
            f.parent.public_key().to_bytes(),
            Some(f.connection),
            10,
            60,
        )
        .await
        .unwrap();
    let job = &jobs[0];
    let accepted = ExternalDeliveryCompletion::Accepted {
        provider_message_id: "wamid.test".into(),
    };
    let early =
        f.db.record_airhop_whatsapp_status(
            &f.tenant,
            f.parent.public_key().to_bytes(),
            f.connection,
            "wamid.test",
            "5511999990000",
            "read",
            Utc::now().timestamp(),
            None,
        )
        .await
        .unwrap();
    assert!(!early);
    assert_eq!(
        f.db.complete_airhop_external_message(
            &f.tenant,
            f.parent.public_key().to_bytes(),
            job.outbox_id,
            job.lease_token,
            &accepted
        )
        .await
        .unwrap(),
        ExternalDeliveryAckState::Accepted
    );
    assert!(f
        .db
        .complete_airhop_external_message(
            &f.tenant,
            f.owner.public_key().to_bytes(),
            job.outbox_id,
            job.lease_token,
            &accepted
        )
        .await
        .is_err());
    assert!(f
        .db
        .claim_airhop_external_messages(
            &f.tenant,
            f.parent.public_key().to_bytes(),
            Some(f.connection),
            10,
            60
        )
        .await
        .unwrap()
        .is_empty());
    assert!(!f
        .db
        .record_airhop_whatsapp_status(
            &f.tenant,
            f.parent.public_key().to_bytes(),
            f.connection,
            "wamid.test",
            "5511888880000",
            "read",
            Utc::now().timestamp(),
            None
        )
        .await
        .unwrap());
    assert!(f
        .db
        .record_airhop_whatsapp_status(
            &f.tenant,
            f.owner.public_key().to_bytes(),
            f.connection,
            "wamid.test",
            "5511999990000",
            "read",
            Utc::now().timestamp(),
            None
        )
        .await
        .is_err());
    for status in [
        "sent",
        "failed",
        "read",
        "delivered",
        "sent",
        "failed",
        "read",
    ] {
        assert!(f
            .db
            .record_airhop_whatsapp_status(
                &f.tenant,
                f.parent.public_key().to_bytes(),
                f.connection,
                "wamid.test",
                "5511999990000",
                status,
                Utc::now().timestamp(),
                (status == "failed").then_some("whatsapp_131026")
            )
            .await
            .unwrap());
    }
    let result:(String,String,bool)=sqlx::query_as("SELECT status,provider_status,read_at IS NOT NULL AND failed_at IS NULL FROM airhop_external_message_outbox WHERE community_id=$1 AND id=$2").bind(f.tenant.community().as_uuid()).bind(job.outbox_id).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(result, ("delivered".into(), "read".into(), true));
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn whatsapp_template_checks_reviewed_content_and_quota_without_bypassing_event_outbox() {
    let f = whatsapp().await;
    let template = json!({"name":"lesson","language":"pt_BR","body":"Aula {{1}}","header":"","footer":"","parameterCount":1});
    sqlx::query("UPDATE airhop_channel_connections SET observed_capabilities=$3 WHERE community_id=$1 AND id=$2").bind(f.tenant.community().as_uuid()).bind(f.connection).bind(json!({"templatesSyncedAt":Utc::now().timestamp(),"utilityTemplates":[template]})).execute(&f.db.pool).await.unwrap();
    let tag = Tag::parse([
        "airhop-whatsapp-template",
        &json!({"name":"lesson","language":"pt_BR","parameters":["10:00"]}).to_string(),
    ])
    .unwrap();
    let event = f.event(&f.owner, "Aula 10:00", vec![tag.clone()]);
    f.insert(&event).await;
    assert_eq!(f.delivery_count().await, 1);
    let changed = f.event(&f.owner, "Completely different text", vec![tag.clone()]);
    let mut tx = f.db.pool.begin().await.unwrap();
    assert!(super::super::whatsapp_templates::validate_template(
        &mut tx,
        *f.tenant.community().as_uuid(),
        f.connection,
        &changed,
        "staff"
    )
    .await
    .is_err());
    assert!(super::super::whatsapp_templates::validate_template(
        &mut tx,
        *f.tenant.community().as_uuid(),
        f.connection,
        &event,
        "hermes"
    )
    .await
    .is_err());
    tx.rollback().await.unwrap();
    // A signed retry does not enqueue another provider message.
    f.insert(&event).await;
    assert_eq!(f.delivery_count().await, 1);
    sqlx::query("INSERT INTO airhop_external_message_outbox(community_id,organization_id,conversation_id,connection_id,route_version,buzz_event_id,event_json,actor_kind,batch_key,sequence) SELECT community_id,organization_id,conversation_id,connection_id,route_version,decode(md5(n::text)||md5(n::text),'hex'),event_json,actor_kind,batch_key,sequence FROM airhop_external_message_outbox CROSS JOIN generate_series(1,19) n WHERE community_id=$1 AND buzz_event_id=$2")
        .bind(f.tenant.community().as_uuid()).bind(event.id.as_bytes().as_slice()).execute(&f.db.pool).await.unwrap();
    let over_limit = f.event(
        &f.owner,
        "Aula 10:00",
        vec![tag, Tag::parse(["nonce", "new-template-attempt"]).unwrap()],
    );
    let mut tx = f.db.pool.begin().await.unwrap();
    let error = super::super::whatsapp_templates::validate_template(
        &mut tx,
        *f.tenant.community().as_uuid(),
        f.connection,
        &over_limit,
        "staff",
    )
    .await
    .unwrap_err();
    assert!(error.to_string().contains("hourly limit"));
    tx.rollback().await.unwrap();
}

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn whatsapp_missing_receipt_expires_without_resend_and_hands_off_to_staff() {
    let f = whatsapp().await;
    f.insert(&f.event(&f.owner, "Ответ без квитанции", vec![]))
        .await;
    let jobs =
        f.db.claim_airhop_external_messages(
            &f.tenant,
            f.parent.public_key().to_bytes(),
            Some(f.connection),
            10,
            60,
        )
        .await
        .unwrap();
    let job = &jobs[0];
    f.db.complete_airhop_external_message(
        &f.tenant,
        f.parent.public_key().to_bytes(),
        job.outbox_id,
        job.lease_token,
        &ExternalDeliveryCompletion::Accepted {
            provider_message_id: "wamid.missing".into(),
        },
    )
    .await
    .unwrap();
    sqlx::query("UPDATE airhop_external_message_outbox SET accepted_at=now()-interval '26 hours' WHERE community_id=$1 AND id=$2").bind(f.tenant.community().as_uuid()).bind(job.outbox_id).execute(&f.db.pool).await.unwrap();
    assert!(f
        .db
        .claim_airhop_external_messages(
            &f.tenant,
            f.parent.public_key().to_bytes(),
            Some(f.connection),
            10,
            60
        )
        .await
        .unwrap()
        .is_empty());
    let state:(String,String,bool)=sqlx::query_as("SELECT queue_status,owner,hermes_paused FROM airhop_external_conversations WHERE community_id=$1 AND id=$2").bind(f.tenant.community().as_uuid()).bind(f.conversation).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(state, ("waiting_staff".into(), "human".into(), true));
    let error:String=sqlx::query_scalar("SELECT last_error_code FROM airhop_external_message_outbox WHERE community_id=$1 AND id=$2").bind(f.tenant.community().as_uuid()).bind(job.outbox_id).fetch_one(&f.db.pool).await.unwrap();
    assert_eq!(error, "whatsapp_delivery_unconfirmed");
    // A real late delivery can resolve delivery uncertainty, but never resumes Hermes.
    assert!(f
        .db
        .record_airhop_whatsapp_status(
            &f.tenant,
            f.parent.public_key().to_bytes(),
            f.connection,
            "wamid.missing",
            "5511999990000",
            "delivered",
            Utc::now().timestamp(),
            None
        )
        .await
        .unwrap());
}
