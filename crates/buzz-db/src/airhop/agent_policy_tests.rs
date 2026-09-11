use super::agent_policy::validate_notice_channel;
use crate::{Db, DbConfig, DbError};
use airhop_core::agent_policy::{AgentPolicy, AgentRole, SetAgentPolicy};
use buzz_core::{CommunityId, TenantContext};
use chrono::{Days, Utc};
use serde_json::json;
use uuid::Uuid;

#[tokio::test]
#[ignore = "requires isolated BUZZ_TEST_DATABASE_URL"]
async fn agent_policy_roles_versions_tenancy_and_notice_recovery() {
    let db = Db::new(&DbConfig {
        database_url: std::env::var("BUZZ_TEST_DATABASE_URL").expect("isolated database"),
        max_connections: 5,
        ..DbConfig::default()
    })
    .await
    .unwrap();
    db.migrate().await.unwrap();
    let community = Uuid::new_v4();
    let organization = Uuid::new_v4();
    let channel = Uuid::new_v4();
    let owner = [71; 32];
    let staff = [72; 32];
    let tenant = TenantContext::resolved(
        CommunityId::from_uuid(community),
        format!("agent-{community}.test"),
    );
    sqlx::query("INSERT INTO communities(id,host) VALUES($1,$2)")
        .bind(community)
        .bind(tenant.host())
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO airhop_organizations(community_id,id,name,locale,time_zone,default_trial_policy) VALUES($1,$2,'Agent test','ru-RU','UTC',$3)").bind(community).bind(organization).bind(json!({"mode":"free"})).execute(&db.pool).await.unwrap();
    for (key, role) in [(owner, "owner"), (staff, "member")] {
        sqlx::query("INSERT INTO relay_members(community_id,pubkey,role) VALUES($1,$2,$3)")
            .bind(community)
            .bind(hex::encode(key))
            .bind(role)
            .execute(&db.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO users(community_id,pubkey) VALUES($1,$2)")
            .bind(community)
            .bind(key.as_slice())
            .execute(&db.pool)
            .await
            .unwrap();
    }
    sqlx::query("INSERT INTO channels(community_id,id,name,visibility,created_by) VALUES($1,$2,'Branch','private',$3)").bind(community).bind(channel).bind(owner.as_slice()).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES($1,$2,$3,'member')").bind(community).bind(channel).bind(staff.as_slice()).execute(&db.pool).await.unwrap();
    assert_eq!(
        db.airhop_agent_policies(&tenant, &staff).await.unwrap()["canManage"],
        false
    );
    let mut policy = AgentPolicy::for_role(AgentRole::Administrator);
    let birthday = policy.birthdays.as_mut().unwrap();
    birthday.time.hour = 0;
    birthday.time.minute = 0;
    let mut command = SetAgentPolicy {
        role: AgentRole::Administrator,
        expected_version: 0,
        policy,
    };
    assert!(db
        .apply_airhop_agent_policy(&tenant, &staff, &[1; 32], &command)
        .await
        .is_err());
    let saved = db
        .apply_airhop_agent_policy(&tenant, &owner, &[1; 32], &command)
        .await
        .unwrap();
    assert_eq!(saved["version"], 1);
    assert_eq!(
        db.apply_airhop_agent_policy(&tenant, &owner, &[1; 32], &command)
            .await
            .unwrap(),
        saved
    );
    assert!(matches!(
        db.apply_airhop_agent_policy(&tenant, &owner, &[2; 32], &command)
            .await,
        Err(DbError::AirhopVersionConflict)
    ));
    let alien = TenantContext::resolved(CommunityId::from_uuid(Uuid::new_v4()), "other.test");
    assert!(db
        .apply_airhop_agent_policy(&alien, &owner, &[1; 32], &command)
        .await
        .is_err());

    let branch = Uuid::new_v4();
    let group = Uuid::new_v4();
    let family = Uuid::new_v4();
    let child = Uuid::new_v4();
    sqlx::query("INSERT INTO airhop_branches(community_id,organization_id,id,name,address,default_buzz_channel_id) VALUES($1,$2,$3,'Branch','Address',$4)").bind(community).bind(organization).bind(branch).bind(channel).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_groups(community_id,organization_id,id,branch_id,name) VALUES($1,$2,$3,$4,'Group')").bind(community).bind(organization).bind(group).bind(branch).execute(&db.pool).await.unwrap();
    let representative = Uuid::new_v4();
    let mut family_tx = db.pool.begin().await.unwrap();
    sqlx::query("INSERT INTO airhop_families(community_id,organization_id,id,display_name,primary_representative_id) VALUES($1,$2,$3,'Family',$4)").bind(community).bind(organization).bind(family).bind(representative).execute(family_tx.as_mut()).await.unwrap();
    sqlx::query("INSERT INTO airhop_representatives(community_id,organization_id,id,family_id,display_name,phone_normalized,phone_display,phone_match_digest) VALUES($1,$2,$3,$4,'Parent','+19995550123','+19995550123',$5)").bind(community).bind(organization).bind(representative).bind(family).bind([1u8;32].as_slice()).execute(family_tx.as_mut()).await.unwrap();
    family_tx.commit().await.unwrap();
    let now = Utc::now();
    let date = now.date_naive();
    sqlx::query("INSERT INTO airhop_children(community_id,organization_id,id,family_id,display_name,birth_date) VALUES($1,$2,$3,$4,'Test Child',($5::date-interval '5 years')::date)").bind(community).bind(organization).bind(child).bind(family).bind(date).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_enrollments(community_id,organization_id,family_id,child_id,group_id,start_date,assignment_state,source,created_by) VALUES($1,$2,$3,$4,$5,$6,'needs_assignment','staff_ui','test')").bind(community).bind(organization).bind(family).bind(child).bind(group).bind(date.checked_sub_days(Days::new(10)).unwrap()).execute(&db.pool).await.unwrap();
    let upcoming_child = Uuid::new_v4();
    let upcoming = date.checked_add_days(Days::new(2)).unwrap();
    sqlx::query("INSERT INTO airhop_children(community_id,organization_id,id,family_id,display_name,birth_date) VALUES($1,$2,$3,$4,'Upcoming Child',($5::date-interval '8 years')::date)").bind(community).bind(organization).bind(upcoming_child).bind(family).bind(upcoming).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_enrollments(community_id,organization_id,family_id,child_id,group_id,start_date,assignment_state,source,created_by) VALUES($1,$2,$3,$4,$5,$6,'needs_assignment','staff_ui','test')").bind(community).bind(organization).bind(family).bind(upcoming_child).bind(group).bind(date).execute(&db.pool).await.unwrap();
    // Sort an invalid branch destination first: it must neither receive child
    // data nor prevent the valid branch from receiving its own digest.
    let invalid_channel = Uuid::from_u128(1);
    let invalid_branch = Uuid::new_v4();
    let invalid_group = Uuid::new_v4();
    sqlx::query("INSERT INTO channels(community_id,id,name,visibility,created_by) VALUES($1,$2,'Public branch','open',$3)")
        .bind(community).bind(invalid_channel).bind(owner.as_slice()).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_branches(community_id,organization_id,id,name,address,default_buzz_channel_id) VALUES($1,$2,$3,'Other branch','Address',$4)")
        .bind(community).bind(organization).bind(invalid_branch).bind(invalid_channel).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_groups(community_id,organization_id,id,branch_id,name) VALUES($1,$2,$3,$4,'Other group')")
        .bind(community).bind(organization).bind(invalid_group).bind(invalid_branch).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_enrollments(community_id,organization_id,family_id,child_id,group_id,start_date,assignment_state,source,created_by) VALUES($1,$2,$3,$4,$5,$6,'needs_assignment','staff_ui','test')")
        .bind(community).bind(organization).bind(family).bind(child).bind(invalid_group).bind(date).execute(&db.pool).await.unwrap();
    let first = db.prepare_airhop_agent_notices(now).await.unwrap();
    assert!(!first
        .iter()
        .any(|job| job.community_id == tenant.community() && job.channel_id == invalid_channel));
    let job = first
        .iter()
        .find(|j| j.community_id == tenant.community())
        .expect("birthday digest");
    assert_eq!(job.channel_id, channel);
    assert!(job
        .content
        .contains("Сегодня: Test Child — исполняется 5 лет"));
    assert!(job.content.contains("Upcoming Child — исполняется 8 лет"));
    assert_eq!(job.content.matches("Upcoming Child").count(), 1);
    let again = db.prepare_airhop_agent_notices(now).await.unwrap();
    assert_eq!(
        again
            .iter()
            .filter(|j| j.community_id == tenant.community())
            .count(),
        1
    );
    assert_eq!(
        again
            .iter()
            .find(|j| j.community_id == tenant.community())
            .unwrap()
            .id,
        job.id
    );
    let guard = db.lock_airhop_agent_notice(job).await.unwrap().unwrap();
    assert!(db.lock_airhop_agent_notice(job).await.unwrap().is_none());
    guard.rollback().await.unwrap();
    command.expected_version = 1;
    command.policy.enabled = false;
    db.apply_airhop_agent_policy(&tenant, &owner, &[3; 32], &command)
        .await
        .unwrap();
    assert!(db.lock_airhop_agent_notice(job).await.unwrap().is_none());
    assert!(db
        .require_airhop_agent_enabled(&tenant, AgentRole::Administrator)
        .await
        .is_err());
    assert_eq!(
        db.airhop_agent_policy(&tenant, AgentRole::Analyst)
            .await
            .unwrap()
            .1,
        0
    );
    // A newly admitted outsider to the channel invalidates delivery, even if it was previously valid.
    sqlx::query(
        "INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES($1,$2,$3,'guest')",
    )
    .bind(community)
    .bind(channel)
    .bind([73u8; 32].as_slice())
    .execute(&db.pool)
    .await
    .unwrap();
    let mut connection = db.pool.acquire().await.unwrap();
    assert!(validate_notice_channel(&mut connection, community, channel)
        .await
        .is_err());
    drop(connection);
    // Turning a duty off must remain possible after its former destination becomes unsafe.
    command.expected_version = 2;
    command.policy.birthdays.as_mut().unwrap().destination =
        airhop_core::agent_policy::NoticeDestination::Channel {
            channel_id: channel,
        };
    db.apply_airhop_agent_policy(&tenant, &owner, &[4; 32], &command)
        .await
        .unwrap();

    use airhop_core::{
        agent_graph::GRAPH_VERSION,
        agent_learning::{AgentLearningCommand, FactSource, ProcedurePlan},
        agent_policy::LearningMode,
    };
    let agent = nostr::Keys::generate();
    let agent_key = agent.public_key().to_bytes();
    sqlx::query("INSERT INTO airhop_welcome_teams(community_id,organization_id,channel_id,locale,fizz_pubkey,administrator_pubkey,analyst_pubkey,content_marketer_pubkey,registered_by_pubkey) VALUES($1,$2,$3,'ru-RU',$4,$5,$6,$7,$8)")
        .bind(community).bind(organization).bind(channel).bind(agent_key.as_slice()).bind([81u8;32].as_slice()).bind([82u8;32].as_slice()).bind([83u8;32].as_slice()).bind(owner.as_slice()).execute(&db.pool).await.unwrap();
    let plan = ProcedurePlan {
        graph_version: GRAPH_VERSION.into(),
        sources: vec![FactSource::Knowledge],
    };
    let mut candidate = Uuid::nil();
    for n in 0..3 {
        let reply = nostr::EventBuilder::new(
            nostr::Kind::Custom(9),
            format!("Completed synthetic case {n}"),
        )
        .tags([nostr::Tag::parse(["h", channel.to_string().as_str()]).unwrap()])
        .sign_with_keys(&agent)
        .unwrap();
        db.insert_event(tenant.community(), &reply, Some(channel))
            .await
            .unwrap();
        let observation = AgentLearningCommand::Observe {
            role: AgentRole::Fizz,
            reply_event_id: reply.id.to_hex(),
            plan: plan.clone(),
        };
        assert!(db
            .apply_airhop_agent_learning(&tenant, &owner, &[90; 32], &observation)
            .await
            .is_err());
        let receipt = db
            .apply_airhop_agent_learning(&tenant, &agent_key, &[90; 32], &observation)
            .await
            .unwrap();
        candidate = Uuid::parse_str(receipt["procedureId"].as_str().unwrap()).unwrap();
        assert_eq!(
            db.apply_airhop_agent_learning(&tenant, &agent_key, &[90; 32], &observation)
                .await
                .unwrap()["replayed"],
            true
        );
    }
    assert_eq!(
        db.airhop_agent_procedures(&tenant, AgentRole::Fizz)
            .await
            .unwrap()["candidates"][0]["observations"],
        3
    );
    let activation = AgentLearningCommand::Activate {
        role: AgentRole::Fizz,
        procedure_id: Some(candidate),
        expected_version: 0,
    };
    assert!(
        db.apply_airhop_agent_learning(&tenant, &owner, &[91; 32], &activation)
            .await
            .is_err(),
        "observe mode cannot activate"
    );
    let mut fizz_policy = AgentPolicy::for_role(AgentRole::Fizz);
    fizz_policy.learning = LearningMode::Validated;
    db.apply_airhop_agent_policy(
        &tenant,
        &owner,
        &[92; 32],
        &SetAgentPolicy {
            role: AgentRole::Fizz,
            expected_version: 0,
            policy: fizz_policy,
        },
    )
    .await
    .unwrap();
    assert!(
        db.apply_airhop_agent_learning(&tenant, &agent_key, &[91; 32], &activation)
            .await
            .is_err(),
        "agent cannot review itself"
    );
    assert_eq!(
        db.apply_airhop_agent_learning(&tenant, &owner, &[91; 32], &activation)
            .await
            .unwrap()["version"],
        1
    );
    assert_eq!(
        db.apply_airhop_agent_learning(&tenant, &owner, &[91; 32], &activation)
            .await
            .unwrap()["replayed"],
        true
    );
    assert!(db
        .active_airhop_agent_procedure(&tenant, AgentRole::Fizz)
        .await
        .unwrap()
        .is_some());
    assert!(db
        .active_airhop_agent_procedure(&tenant, AgentRole::Analyst)
        .await
        .unwrap()
        .is_none());
    db.apply_airhop_agent_learning(
        &tenant,
        &owner,
        &[93; 32],
        &AgentLearningCommand::Activate {
            role: AgentRole::Fizz,
            procedure_id: None,
            expected_version: 1,
        },
    )
    .await
    .unwrap();
    assert!(db
        .active_airhop_agent_procedure(&tenant, AgentRole::Fizz)
        .await
        .unwrap()
        .is_none());
}
