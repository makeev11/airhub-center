//! Run against an isolated database only; no model or live messages are used.
use super::welcome_agents::{AirhopWelcomeRole, PutWelcomeTeamInput};
use crate::{Db, DbConfig};
use airhop_core::agent_access::{
    AgentAudience, AgentConversationAccess, AgentConversationSurfaces,
};
use airhop_core::agent_policy::{AgentPolicy, AgentRole, SetAgentPolicy};
use buzz_core::{CommunityId, TenantContext};
use nostr::{Event, EventBuilder, Keys, Kind, Tag};
use serde_json::json;
use std::collections::BTreeMap;
use uuid::Uuid;

async fn message(
    db: &Db,
    tenant: &TenantContext,
    channel: Uuid,
    keys: &Keys,
    target: Option<[u8; 32]>,
) -> Event {
    let mut tags = vec![Tag::parse(["h", &channel.to_string()]).unwrap()];
    if let Some(target) = target {
        tags.push(Tag::parse(["p", &hex::encode(target)]).unwrap());
    }
    let event = EventBuilder::new(Kind::Custom(9), format!("hello {}", Uuid::new_v4()))
        .tags(tags)
        .sign_with_keys(keys)
        .unwrap();
    db.insert_event(tenant.community(), &event, Some(channel))
        .await
        .unwrap();
    event
}

async fn save(
    db: &Db,
    tenant: &TenantContext,
    owner: &[u8; 32],
    version: i64,
    audience: AgentAudience,
    surfaces: AgentConversationSurfaces,
) {
    save_role(
        db,
        tenant,
        owner,
        AgentRole::Analyst,
        version,
        audience,
        surfaces,
    )
    .await;
}

async fn save_role(
    db: &Db,
    tenant: &TenantContext,
    owner: &[u8; 32],
    role: AgentRole,
    version: i64,
    audience: AgentAudience,
    surfaces: AgentConversationSurfaces,
) {
    let mut policy = AgentPolicy::for_role(role);
    policy.communication = Some(AgentConversationAccess { audience, surfaces });
    db.apply_airhop_agent_policy(
        tenant,
        owner,
        &Keys::generate().public_key().to_bytes(),
        &SetAgentPolicy {
            role,
            expected_version: version,
            policy,
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
#[ignore = "requires isolated BUZZ_TEST_DATABASE_URL"]
async fn explicit_conversation_access_scopes_rechecks_and_deduplicates() {
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
    let tenant = TenantContext::resolved(
        CommunityId::from_uuid(community),
        format!("conversation-{community}.test"),
    );
    sqlx::query("INSERT INTO communities(id,host) VALUES($1,$2)")
        .bind(community)
        .bind(tenant.host())
        .execute(&db.pool)
        .await
        .unwrap();
    sqlx::query("INSERT INTO airhop_organizations(community_id,id,name,locale,time_zone,default_trial_policy) VALUES($1,$2,'Access test','ru-RU','UTC',$3)").bind(community).bind(organization).bind(json!({"mode":"free"})).execute(&db.pool).await.unwrap();
    let owner_keys = Keys::generate();
    let owner = owner_keys.public_key().to_bytes();
    let staff_keys = Keys::generate();
    let staff = staff_keys.public_key().to_bytes();
    sqlx::query("INSERT INTO users(community_id,pubkey) VALUES($1,$2)")
        .bind(community)
        .bind(owner.as_slice())
        .execute(&db.pool)
        .await
        .unwrap();
    for (key, role) in [(owner, "owner"), (staff, "member")] {
        sqlx::query("INSERT INTO relay_members(community_id,pubkey,role) VALUES($1,$2,$3)")
            .bind(community)
            .bind(hex::encode(key))
            .bind(role)
            .execute(&db.pool)
            .await
            .unwrap();
    }
    let mut channels = Vec::new();
    for (name, channel_type) in [
        ("Welcome", "stream"),
        ("аналитика", "stream"),
        ("Owner DM", "dm"),
        ("Staff DM", "dm"),
    ] {
        let id = Uuid::new_v4();
        sqlx::query("INSERT INTO channels(community_id,id,name,channel_type,visibility,created_by) VALUES($1,$2,$3,$4::channel_type,'private',$5)").bind(community).bind(id).bind(name).bind(channel_type).bind(owner.as_slice()).execute(&db.pool).await.unwrap();
        channels.push(id);
    }
    let agent_keys = AirhopWelcomeRole::ALL.map(|_| Keys::generate());
    let members = BTreeMap::from_iter(
        AirhopWelcomeRole::ALL
            .into_iter()
            .zip(agent_keys.iter().map(|keys| keys.public_key().to_bytes())),
    );
    let analyst = members[&AirhopWelcomeRole::Analyst];
    for (role, key) in &members {
        sqlx::query("INSERT INTO users(community_id,pubkey,agent_type,agent_owner_pubkey) VALUES($1,$2,'managed-agent',$3)").bind(community).bind(key.as_slice()).bind(owner.as_slice()).execute(&db.pool).await.unwrap();
        for channel in if *role == AirhopWelcomeRole::Analyst {
            channels.clone()
        } else {
            vec![channels[0]]
        } {
            sqlx::query("INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES($1,$2,$3,'bot')").bind(community).bind(channel).bind(key.as_slice()).execute(&db.pool).await.unwrap();
        }
    }
    for (index, channel) in channels.iter().enumerate() {
        let humans = match index {
            2 => vec![owner],
            3 => vec![staff],
            _ => vec![owner, staff],
        };
        for human in humans {
            sqlx::query("INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES($1,$2,$3,'member')").bind(community).bind(channel).bind(human.as_slice()).execute(&db.pool).await.unwrap();
        }
    }
    db.put_airhop_welcome_team(
        &tenant,
        &PutWelcomeTeamInput {
            organization_id: organization,
            channel_id: channels[0],
            locale: "ru-RU".into(),
            members: members.clone(),
            registered_by_pubkey: owner,
        },
    )
    .await
    .unwrap();
    let owner_dm = message(&db, &tenant, channels[2], &owner_keys, None).await;
    let staff_dm = message(&db, &tenant, channels[3], &staff_keys, None).await;
    let staff_stream = message(&db, &tenant, channels[1], &staff_keys, Some(analyst)).await;
    let owner_stream = message(&db, &tenant, channels[1], &owner_keys, Some(analyst)).await;
    let unmentioned = message(&db, &tenant, channels[1], &owner_keys, None).await;
    // Absent configuration never grants access to additional surfaces.
    assert!(db
        .claim_airhop_welcome_route(&tenant, *owner_dm.id.as_bytes(), analyst)
        .await
        .is_err());
    save(
        &db,
        &tenant,
        &owner,
        0,
        AgentAudience::Owner {},
        AgentConversationSurfaces::Both,
    )
    .await;
    let route = db
        .claim_airhop_welcome_route(&tenant, *owner_dm.id.as_bytes(), analyst)
        .await
        .unwrap();
    assert_eq!(route.channel_id, channels[2]);
    assert!(route.communication_configured);
    let welcome_question = message(
        &db,
        &tenant,
        channels[0],
        &owner_keys,
        Some(members[&AirhopWelcomeRole::Fizz]),
    )
    .await;
    let fizz_keys = agent_keys
        .iter()
        .find(|key| key.public_key().to_bytes() == members[&AirhopWelcomeRole::Fizz])
        .unwrap();
    let handoff = |source: Option<&Event>| {
        let mut tags = vec![
            Tag::parse(["h", &channels[0].to_string()]).unwrap(),
            Tag::parse(["p", &hex::encode(analyst)]).unwrap(),
            Tag::parse(["airhop-handoff", "analyst"]).unwrap(),
            Tag::parse(["airhop-agent-turn", "fizz"]).unwrap(),
        ];
        if let Some(source) = source {
            tags.push(Tag::parse(["airhop-human-source", &source.id.to_hex()]).unwrap());
        }
        EventBuilder::new(
            Kind::Custom(buzz_core::kind::KIND_AIRHOP_AGENT_TASK as u16),
            "task",
        )
        .tags(tags)
        .sign_with_keys(fizz_keys)
        .unwrap()
    };
    assert!(db
        .apply_airhop_welcome_ephemeral_turn(&tenant, &handoff(None), channels[0])
        .await
        .is_err());
    assert!(db
        .apply_airhop_welcome_ephemeral_turn(&tenant, &handoff(Some(&owner_dm)), channels[0])
        .await
        .is_err());
    let assignment = handoff(Some(&welcome_question));
    db.apply_airhop_welcome_ephemeral_turn(&tenant, &assignment, channels[0])
        .await
        .unwrap();
    assert!(
        db.claim_airhop_welcome_route(&tenant, *assignment.id.as_bytes(), analyst)
            .await
            .unwrap()
            .communication_configured
    );
    assert!(db
        .claim_airhop_welcome_route(&tenant, *staff_dm.id.as_bytes(), analyst)
        .await
        .is_err());
    assert!(db
        .claim_airhop_welcome_route(&tenant, *owner_stream.id.as_bytes(), analyst)
        .await
        .is_ok());
    assert!(db
        .claim_airhop_welcome_route(&tenant, *unmentioned.id.as_bytes(), analyst)
        .await
        .is_err());
    save(
        &db,
        &tenant,
        &owner,
        1,
        AgentAudience::Staff {},
        AgentConversationSurfaces::Channels,
    )
    .await;
    assert!(db
        .claim_airhop_welcome_route(&tenant, *owner_dm.id.as_bytes(), analyst)
        .await
        .is_err());
    assert!(db
        .claim_airhop_welcome_route(&tenant, *staff_stream.id.as_bytes(), analyst)
        .await
        .is_ok());

    // Reproduce the production topology: the relay admits both the parent
    // runtime and a provider connector, but each service is assigned only to a
    // private client channel. Neither service becomes a reader of every open
    // employee channel merely by appearing in relay_members.
    let client_channel = Uuid::new_v4();
    sqlx::query("INSERT INTO channels(community_id,id,name,channel_type,visibility,created_by) VALUES($1,$2,'Client inbox','stream','private',$3)")
        .bind(community).bind(client_channel).bind(owner.as_slice()).execute(&db.pool).await.unwrap();
    let parent = Keys::generate().public_key().to_bytes();
    let connector = Keys::generate().public_key().to_bytes();
    for service in [parent, connector] {
        sqlx::query("INSERT INTO relay_members(community_id,pubkey,role) VALUES($1,$2,'member')")
            .bind(community)
            .bind(hex::encode(service))
            .execute(&db.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES($1,$2,$3,'bot')")
            .bind(community).bind(client_channel).bind(service.as_slice()).execute(&db.pool).await.unwrap();
    }
    sqlx::query("INSERT INTO airhop_agent_deployments(community_id,organization_id,id,blueprint_key,blueprint_version,role,agent_pubkey,profile_ref,runtime_revision,persona_revision,skills_revision,model_revision,registered_by_pubkey) VALUES($1,$2,$3,'airhop.hermes.parent_administrator',1,'parent_administrator',$4,'test','test','test','test','test',$5)")
        .bind(community).bind(organization).bind(Uuid::new_v4()).bind(parent.as_slice()).bind(owner.as_slice()).execute(&db.pool).await.unwrap();
    sqlx::query("INSERT INTO airhop_channel_connections(community_id,organization_id,id,provider,display_name,connector_pubkey,status,hermes_enabled,updated_by_pubkey,buzz_channel_id) VALUES($1,$2,$3,'telegram','Test connector',$4,'active',true,$5,$6)")
        .bind(community).bind(organization).bind(Uuid::new_v4()).bind(connector.as_slice()).bind(owner.as_slice()).bind(client_channel).execute(&db.pool).await.unwrap();

    sqlx::query("UPDATE channels SET visibility='open' WHERE community_id=$1 AND id=$2")
        .bind(community)
        .bind(channels[1])
        .execute(&db.pool)
        .await
        .unwrap();
    assert!(db
        .require_airhop_internal_destination(&tenant, channels[1], false)
        .await
        .is_err());
    db.require_airhop_internal_destination(&tenant, channels[1], true)
        .await
        .unwrap();
    for service in [parent, connector] {
        let accessible = db
            .get_accessible_channel_ids(tenant.community(), service.as_slice())
            .await
            .unwrap();
        assert!(accessible.contains(&client_channel));
        assert!(!accessible.contains(&channels[1]));
        assert!(db
            .can_read_channel(tenant.community(), client_channel, service.as_slice())
            .await
            .unwrap());
        assert!(!db
            .can_read_channel(tenant.community(), channels[1], service.as_slice())
            .await
            .unwrap());
    }

    // All four product roles use the same guard and may answer an exact mention
    // in the open staff channel despite those unrelated service principals.
    for role in AirhopWelcomeRole::ALL {
        let agent = members[&role];
        if role != AirhopWelcomeRole::Analyst {
            sqlx::query("INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES($1,$2,$3,'bot')")
                .bind(community).bind(channels[1]).bind(agent.as_slice()).execute(&db.pool).await.unwrap();
            save_role(
                &db,
                &tenant,
                &owner,
                AgentRole::parse(role.as_str()).unwrap(),
                0,
                AgentAudience::Staff {},
                AgentConversationSurfaces::Channels,
            )
            .await;
        }
        let exact = message(&db, &tenant, channels[1], &staff_keys, Some(agent)).await;
        let route = db
            .claim_airhop_welcome_route(&tenant, *exact.id.as_bytes(), agent)
            .await
            .unwrap();
        assert_eq!(route.target_role, role);
    }

    // A genuine effective outsider still blocks, with a safe reason that can
    // be shown privately only by the exact addressed claimant.
    let external_reader = Keys::generate().public_key().to_bytes();
    sqlx::query("INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES($1,$2,$3,'member')")
        .bind(community).bind(channels[1]).bind(external_reader.as_slice()).execute(&db.pool).await.unwrap();
    let rejected = message(&db, &tenant, channels[1], &staff_keys, Some(analyst)).await;
    let error = db
        .claim_airhop_welcome_route(&tenant, *rejected.id.as_bytes(), analyst)
        .await
        .unwrap_err();
    match error {
        crate::DbError::AirhopAgentRequestDenied(denial) => {
            assert_eq!(
                denial.reason,
                crate::AirhopAgentRequestDenialReason::ExternalReaders
            );
            assert_eq!(denial.source_author_pubkey, staff);
            assert_eq!(denial.target_pubkey, analyst);
            assert_eq!(denial.channel_id, channels[1]);
        }
        other => panic!("expected author-visible external-reader denial, got {other}"),
    }
    sqlx::query("UPDATE channel_members SET removed_at=now() WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3")
        .bind(community).bind(channels[1]).bind(external_reader.as_slice()).execute(&db.pool).await.unwrap();
    assert!(db
        .claim_airhop_welcome_route(&tenant, *rejected.id.as_bytes(), analyst)
        .await
        .is_ok());

    sqlx::query("UPDATE channels SET visibility='private' WHERE community_id=$1 AND id=$2")
        .bind(community)
        .bind(channels[1])
        .execute(&db.pool)
        .await
        .unwrap();
    save(
        &db,
        &tenant,
        &owner,
        2,
        AgentAudience::Selected {
            pubkeys: vec![hex::encode(staff)],
        },
        AgentConversationSurfaces::DirectMessages,
    )
    .await;
    assert!(db
        .claim_airhop_welcome_route(&tenant, *staff_dm.id.as_bytes(), analyst)
        .await
        .is_ok());
    assert!(db
        .claim_airhop_welcome_route(&tenant, *owner_dm.id.as_bytes(), analyst)
        .await
        .is_err());
    assert!(db
        .claim_airhop_welcome_route(&tenant, *staff_stream.id.as_bytes(), analyst)
        .await
        .is_err());
    // Old-client saves retain the explicit restriction, including a selected list.
    assert!(db
        .claim_airhop_welcome_route(&tenant, *assignment.id.as_bytes(), analyst)
        .await
        .is_err());
    db.apply_airhop_agent_policy(
        &tenant,
        &owner,
        &[91; 32],
        &SetAgentPolicy {
            role: AgentRole::Analyst,
            expected_version: 3,
            policy: AgentPolicy::for_role(AgentRole::Analyst),
        },
    )
    .await
    .unwrap();
    let (policy, revision) = db
        .airhop_agent_policy(&tenant, AgentRole::Analyst)
        .await
        .unwrap();
    assert_eq!(revision, 4);
    assert!(matches!(
        policy.communication.unwrap().audience,
        AgentAudience::Selected { .. }
    ));
    let signing = agent_keys
        .iter()
        .find(|key| key.public_key().to_bytes() == analyst)
        .unwrap();
    let reply = |channel: Uuid, text: &str, source: Option<&Event>| {
        let mut tags = vec![Tag::parse(["h", &channel.to_string()]).unwrap()];
        if let Some(source) = source {
            tags.push(Tag::parse(["airhop-responds-to", &source.id.to_hex()]).unwrap());
        }
        EventBuilder::new(Kind::Custom(9), text)
            .tags(tags)
            .sign_with_keys(signing)
            .unwrap()
    };
    let answer = reply(channels[3], "answer", Some(&staff_dm));
    db.authorize_airhop_agent_publication(&tenant, &analyst, &answer, Some(channels[3]), true)
        .await
        .unwrap();
    assert!(db
        .authorize_airhop_agent_publication(&tenant, &analyst, &answer, Some(channels[2]), true)
        .await
        .is_err());
    assert!(db
        .authorize_airhop_agent_publication(
            &tenant,
            &analyst,
            &reply(channels[3], "CLI bypass", None),
            Some(channels[3]),
            true
        )
        .await
        .is_err());
    db.insert_event(tenant.community(), &answer, Some(channels[3]))
        .await
        .unwrap();
    assert!(db
        .insert_event(
            tenant.community(),
            &reply(channels[3], "duplicate", Some(&staff_dm)),
            Some(channels[3])
        )
        .await
        .is_err());
    let alien = TenantContext::resolved(CommunityId::from_uuid(Uuid::new_v4()), "alien.test");
    assert!(db
        .claim_airhop_welcome_route(&alien, *staff_dm.id.as_bytes(), analyst)
        .await
        .is_err());
    // An outsider cannot become an indirect reader through a permitted speaker.
    let outsider = Keys::generate().public_key().to_bytes();
    sqlx::query("INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES($1,$2,$3,'member')").bind(community).bind(channels[3]).bind(outsider.as_slice()).execute(&db.pool).await.unwrap();
    assert!(db
        .authorize_airhop_agent_publication(&tenant, &analyst, &answer, Some(channels[3]), true)
        .await
        .is_err());
    sqlx::query("UPDATE channel_members SET removed_at=now() WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3").bind(community).bind(channels[3]).bind(outsider.as_slice()).execute(&db.pool).await.unwrap();
    db.authorize_airhop_agent_publication(&tenant, &analyst, &answer, Some(channels[3]), true)
        .await
        .unwrap();
    sqlx::query("UPDATE channel_members SET removed_at=now() WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3").bind(community).bind(channels[3]).bind(analyst.as_slice()).execute(&db.pool).await.unwrap();
    assert!(db
        .authorize_airhop_agent_publication(&tenant, &analyst, &answer, Some(channels[3]), true)
        .await
        .is_err());
    sqlx::query("UPDATE channel_members SET removed_at=NULL WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3").bind(community).bind(channels[3]).bind(analyst.as_slice()).execute(&db.pool).await.unwrap();
    // Current employee membership is checked even for already claimed messages.
    sqlx::query("DELETE FROM relay_members WHERE community_id=$1 AND pubkey=$2")
        .bind(community)
        .bind(hex::encode(staff))
        .execute(&db.pool)
        .await
        .unwrap();
    assert!(db
        .claim_airhop_welcome_route(&tenant, *staff_dm.id.as_bytes(), analyst)
        .await
        .is_err());
    let mut invalid = AgentPolicy::for_role(AgentRole::Analyst);
    invalid.communication = Some(AgentConversationAccess {
        audience: AgentAudience::Selected {
            pubkeys: vec![hex::encode(outsider)],
        },
        surfaces: AgentConversationSurfaces::Both,
    });
    assert!(db
        .apply_airhop_agent_policy(
            &tenant,
            &owner,
            &[92; 32],
            &SetAgentPolicy {
                role: AgentRole::Analyst,
                expected_version: 4,
                policy: invalid
            }
        )
        .await
        .is_err());
    let mut disabled = AgentPolicy::for_role(AgentRole::Analyst);
    disabled.enabled = false;
    db.apply_airhop_agent_policy(
        &tenant,
        &owner,
        &[93; 32],
        &SetAgentPolicy {
            role: AgentRole::Analyst,
            expected_version: 4,
            policy: disabled,
        },
    )
    .await
    .unwrap();
    let saved = db
        .airhop_agent_policy(&tenant, AgentRole::Analyst)
        .await
        .unwrap()
        .0;
    assert!(!saved.enabled && saved.communication.is_some());
}
