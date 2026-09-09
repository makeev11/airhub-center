use super::*;
use crate::{relay_members, DbConfig};
use buzz_core::CommunityId;
use nostr::Keys;
use serde_json::json;

#[tokio::test]
#[ignore = "requires dedicated BUZZ_TEST_DATABASE_URL"]
async fn principal_directory_is_scoped_deduplicated_and_protects_service_keys() {
    let db = Db::new(&DbConfig {
        database_url: std::env::var("BUZZ_TEST_DATABASE_URL").expect("isolated test database"),
        min_connections: 0,
        max_connections: 4,
        ..DbConfig::default()
    })
    .await
    .unwrap();
    db.migrate().await.unwrap();
    let mut fixtures = Vec::new();
    for _ in 0..2 {
        let tenant = TenantContext::resolved(
            CommunityId::from_uuid(Uuid::new_v4()),
            format!("directory-{}.test", Uuid::new_v4()),
        );
        let cid = *tenant.community().as_uuid();
        let org = Uuid::new_v4();
        let channel = Uuid::new_v4();
        let keys: Vec<_> = (0..8).map(|_| Keys::generate()).collect();
        let public: Vec<_> = keys
            .iter()
            .map(|key| key.public_key().to_bytes().to_vec())
            .collect();
        sqlx::query("INSERT INTO communities(id,host) VALUES($1,$2)")
            .bind(cid)
            .bind(tenant.host())
            .execute(&db.pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO airhop_organizations(community_id,id,name,locale,time_zone,default_trial_policy) VALUES($1,$2,'Directory test','ru-RU','Europe/Moscow',$3)").bind(cid).bind(org).bind(json!({"mode":"free"})).execute(&db.pool).await.unwrap();
        sqlx::query("INSERT INTO channels(community_id,id,name,channel_type,visibility,created_by,nip29_group_id) VALUES($1,$2,'team','stream','private',$3,$4)").bind(cid).bind(channel).bind(&public[0]).bind(channel.to_string()).execute(&db.pool).await.unwrap();
        for (i, key) in keys.iter().enumerate() {
            sqlx::query("INSERT INTO relay_members(community_id,pubkey,role) VALUES($1,$2,$3)")
                .bind(cid)
                .bind(key.public_key().to_hex())
                .bind(if i == 0 { "owner" } else { "member" })
                .execute(&db.pool)
                .await
                .unwrap();
            sqlx::query("INSERT INTO channel_members(community_id,channel_id,pubkey,role) VALUES($1,$2,$3,$4::member_role)").bind(cid).bind(channel).bind(&public[i]).bind(if (1..=5).contains(&i) { "bot" } else { "member" }).execute(&db.pool).await.unwrap();
        }
        sqlx::query("INSERT INTO airhop_welcome_teams(community_id,organization_id,channel_id,locale,fizz_pubkey,administrator_pubkey,analyst_pubkey,content_marketer_pubkey,registered_by_pubkey) VALUES($1,$2,$3,'ru-RU',$4,$5,$6,$7,$8)").bind(cid).bind(org).bind(channel).bind(&public[1]).bind(&public[2]).bind(&public[3]).bind(&public[4]).bind(&public[0]).execute(&db.pool).await.unwrap();
        sqlx::query("INSERT INTO airhop_agent_deployments(community_id,organization_id,id,blueprint_key,blueprint_version,role,agent_pubkey,profile_ref,runtime_revision,persona_revision,skills_revision,model_revision,registered_by_pubkey) VALUES($1,$2,$3,'airhop.hermes.parent_administrator',1,'parent_administrator',$4,'test','test','test','test','test',$5)").bind(cid).bind(org).bind(Uuid::new_v4()).bind(&public[5]).bind(&public[0]).execute(&db.pool).await.unwrap();
        // Paused connectors remain service principals and must not become employees.
        sqlx::query("INSERT INTO airhop_channel_connections(community_id,organization_id,id,provider,display_name,connector_pubkey,status,updated_by_pubkey) VALUES($1,$2,$3,'telegram','Gateway',$4,'paused',$5)").bind(cid).bind(org).bind(Uuid::new_v4()).bind(&public[6]).bind(&public[0]).execute(&db.pool).await.unwrap();
        fixtures.push((tenant, org, channel, keys));
    }
    for (tenant, org, channel, keys) in &fixtures {
        let result = db.airhop_principal_directory(tenant, *org).await.unwrap();
        assert_eq!(result["agents"].as_array().unwrap().len(), 5);
        assert_eq!(result["principals"].as_array().unwrap().len(), 6);
        assert_eq!(result["organizationId"], org.to_string());
        let agents: std::collections::HashSet<_> = result["agents"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| row["pubkey"].as_str().unwrap())
            .collect();
        assert_eq!(agents.len(), 5);
        for key in &keys[1..6] {
            assert!(agents.contains(key.public_key().to_hex().as_str()));
        }
        for key in &keys[1..7] {
            let key = key.public_key().to_hex();
            assert!(
                relay_members::remove_relay_member(&db.pool, tenant.community(), &key)
                    .await
                    .is_err()
            );
            assert!(relay_members::remove_relay_member_if_role(
                &db.pool,
                tenant.community(),
                &key,
                "member"
            )
            .await
            .is_err());
            assert!(relay_members::update_relay_member_role(
                &db.pool,
                tenant.community(),
                &key,
                "admin"
            )
            .await
            .is_err());
        }
        // No profile row is needed for a real human; normal owner/member semantics survive.
        assert!(matches!(
            relay_members::remove_relay_member(
                &db.pool,
                tenant.community(),
                &keys[0].public_key().to_hex()
            )
            .await
            .unwrap(),
            relay_members::RemoveResult::IsOwner
        ));
        assert!(matches!(
            relay_members::remove_relay_member(
                &db.pool,
                tenant.community(),
                &keys[7].public_key().to_hex()
            )
            .await
            .unwrap(),
            relay_members::RemoveResult::Removed
        ));
        sqlx::query("UPDATE airhop_agent_deployments SET paused=true WHERE community_id=$1")
            .bind(tenant.community().as_uuid())
            .execute(&db.pool)
            .await
            .unwrap();
        sqlx::query("UPDATE channel_members SET removed_at=now() WHERE community_id=$1 AND channel_id=$2 AND pubkey=$3").bind(tenant.community().as_uuid()).bind(channel).bind(keys[1].public_key().to_bytes().as_slice()).execute(&db.pool).await.unwrap();
        let result = db.airhop_principal_directory(tenant, *org).await.unwrap();
        assert_eq!(result["agents"].as_array().unwrap().len(), 3);
        assert_eq!(result["principals"].as_array().unwrap().len(), 6);
        let wrong_org = db
            .airhop_principal_directory(tenant, Uuid::new_v4())
            .await
            .unwrap();
        assert!(wrong_org["agents"].as_array().unwrap().is_empty());
    }
}
