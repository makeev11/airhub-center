//! Wire-level proof for the Airhop Welcome agent team.
//!
//! Run against the isolated harness:
//! `RELAY_URL=ws://localhost:3030 DATABASE_URL=postgres://buzz:buzz_dev@localhost:5471/buzz \
//! cargo test -p buzz-test-client --test e2e_airhop_welcome_agents -- --ignored --nocapture`

use base64::engine::general_purpose::STANDARD as BASE64;
use base64::Engine;
use nostr::{Event, EventBuilder, Keys, Kind, Tag};
use reqwest::{Method, StatusCode};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use sqlx::{PgPool, Row};
use uuid::Uuid;

fn relay_http_url() -> String {
    std::env::var("RELAY_URL")
        .unwrap_or_else(|_| "ws://localhost:3030".to_owned())
        .replace("wss://", "https://")
        .replace("ws://", "http://")
        .trim_end_matches('/')
        .to_owned()
}

async fn db_pool() -> PgPool {
    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "postgres://buzz:buzz_dev@localhost:5471/buzz".to_owned());
    sqlx::postgres::PgPoolOptions::new()
        .max_connections(2)
        .connect(&database_url)
        .await
        .expect("connect to isolated Airhop Postgres")
}

fn nip98_header(keys: &Keys, method: &Method, url: &str, body: Option<&str>) -> String {
    let mut tags = vec![
        Tag::parse(["u", url]).expect("NIP-98 u tag"),
        Tag::parse(["method", method.as_str()]).expect("NIP-98 method tag"),
        Tag::parse(["nonce", &Uuid::new_v4().to_string()]).expect("NIP-98 nonce tag"),
    ];
    if let Some(body) = body {
        let digest = hex::encode(Sha256::digest(body.as_bytes()));
        tags.push(Tag::parse(["payload", &digest]).expect("NIP-98 payload tag"));
    }
    let event = EventBuilder::new(Kind::Custom(27_235), "")
        .tags(tags)
        .sign_with_keys(keys)
        .expect("sign NIP-98 event");
    format!(
        "Nostr {}",
        BASE64.encode(serde_json::to_string(&event).expect("serialize NIP-98 event"))
    )
}

async fn api_json(
    keys: &Keys,
    host: &str,
    method: Method,
    path: &str,
    body: Option<&Value>,
) -> (StatusCode, Value) {
    api_json_with_auth_tag(keys, host, method, path, body, None).await
}

async fn api_json_with_auth_tag(
    keys: &Keys,
    host: &str,
    method: Method,
    path: &str,
    body: Option<&Value>,
    auth_tag: Option<&str>,
) -> (StatusCode, Value) {
    let connection_url = format!("{}{path}", relay_http_url());
    let signed_url = format!("http://{host}{path}");
    let body = body.map(|value| serde_json::to_string(value).expect("serialize API body"));
    let mut request = reqwest::Client::new()
        .request(method.clone(), connection_url)
        .header(reqwest::header::HOST, host)
        .header(
            reqwest::header::AUTHORIZATION,
            nip98_header(keys, &method, &signed_url, body.as_deref()),
        );
    if let Some(auth_tag) = auth_tag {
        request = request.header("x-auth-tag", auth_tag);
    }
    if let Some(body) = body {
        request = request
            .header(reqwest::header::CONTENT_TYPE, "application/json")
            .body(body);
    }
    let response = request.send().await.expect("send Airhop API request");
    let status = response.status();
    let text = response.text().await.expect("read Airhop API response");
    let value = serde_json::from_str(&text).unwrap_or_else(|_| json!({"raw": text}));
    (status, value)
}

async fn submit_event(host: &str, event: &Event) -> StatusCode {
    let response = reqwest::Client::new()
        .post(format!("{}/events", relay_http_url()))
        .header(reqwest::header::HOST, host)
        .header("X-Pubkey", event.pubkey.to_hex())
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(serde_json::to_string(event).expect("serialize Nostr event"))
        .send()
        .await
        .expect("submit Nostr event");
    response.status()
}

struct TenantIdentities<'a> {
    owner: &'a Keys,
    agents: &'a [Keys; 4],
    attacker: &'a Keys,
}

async fn seed_tenant(
    pool: &PgPool,
    host: &str,
    requested_community_id: Uuid,
    organization_id: Uuid,
    channel_id: Uuid,
    identities: TenantIdentities<'_>,
) -> Uuid {
    let TenantIdentities {
        owner,
        agents,
        attacker,
    } = identities;
    sqlx::query(
        "INSERT INTO communities (id, host) VALUES ($1, $2) \
         ON CONFLICT (lower(host)) DO NOTHING",
    )
    .bind(requested_community_id)
    .bind(host)
    .execute(pool)
    .await
    .expect("seed community");
    let community_id: Uuid =
        sqlx::query_scalar("SELECT id FROM communities WHERE lower(host) = lower($1)")
            .bind(host)
            .fetch_one(pool)
            .await
            .expect("lookup community");

    sqlx::query(
        "INSERT INTO airhop_organizations (
             community_id, id, name, locale, time_zone, default_trial_policy
         ) VALUES ($1, $2, 'E2E Airhop', 'ru-RU', 'Europe/Moscow',
                   '{\"mode\":\"free\"}'::jsonb)
         ON CONFLICT (community_id) DO UPDATE
         SET status = 'active', default_trial_policy = EXCLUDED.default_trial_policy",
    )
    .bind(community_id)
    .bind(organization_id)
    .execute(pool)
    .await
    .expect("seed Airhop organization");

    sqlx::query(
        "INSERT INTO channels (
             community_id, id, name, channel_type, visibility, created_by
         ) VALUES ($1, $2, 'welcome', 'stream', 'private', $3)
         ON CONFLICT (community_id, id) DO UPDATE
         SET visibility = 'private', archived_at = NULL, deleted_at = NULL",
    )
    .bind(community_id)
    .bind(channel_id)
    .bind(owner.public_key().to_bytes().as_slice())
    .execute(pool)
    .await
    .expect("seed Welcome channel");

    let mut identities: Vec<(&Keys, Option<&str>, &str)> =
        vec![(owner, None, "owner"), (attacker, None, "member")];
    for agent in agents {
        identities.push((agent, Some("buzz_agent"), "bot"));
    }
    for (keys, agent_type, channel_role) in identities {
        let pubkey = keys.public_key().to_bytes();
        sqlx::query(
            "INSERT INTO users (community_id, pubkey, display_name, agent_type)
             VALUES ($1, $2, 'Airhop E2E', $3)
             ON CONFLICT (community_id, pubkey) DO UPDATE
             SET agent_type = EXCLUDED.agent_type, deactivated_at = NULL",
        )
        .bind(community_id)
        .bind(pubkey.as_slice())
        .bind(agent_type)
        .execute(pool)
        .await
        .expect("seed user");
        sqlx::query(
            "INSERT INTO channel_members (community_id, channel_id, pubkey, role)
             VALUES ($1, $2, $3, $4::member_role)
             ON CONFLICT (community_id, channel_id, pubkey) DO UPDATE
             SET role = EXCLUDED.role, removed_at = NULL",
        )
        .bind(community_id)
        .bind(channel_id)
        .bind(pubkey.as_slice())
        .bind(channel_role)
        .execute(pool)
        .await
        .expect("seed channel member");
        let relay_role = if channel_role == "owner" {
            "owner"
        } else {
            "member"
        };
        sqlx::query(
            "INSERT INTO relay_members (community_id, pubkey, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (community_id, pubkey) DO UPDATE SET role = EXCLUDED.role",
        )
        .bind(community_id)
        .bind(keys.public_key().to_hex())
        .bind(relay_role)
        .execute(pool)
        .await
        .expect("seed relay member");
    }
    community_id
}

fn team_body(organization_id: Uuid, channel_id: Uuid, agents: &[Keys; 4]) -> Value {
    json!({
        "organizationId": organization_id,
        "channelId": channel_id,
        "locale": "ru-RU",
        "members": {
            "fizz": agents[0].public_key().to_hex(),
            "administrator": agents[1].public_key().to_hex(),
            "analyst": agents[2].public_key().to_hex(),
            "content_marketer": agents[3].public_key().to_hex(),
        }
    })
}

fn branch_command(name: &str) -> Value {
    json!({
        "type": "create_branch",
        "input": {
            "name": name,
            "address": "Тестовая улица, 1",
            "workingHours": {},
            "defaultBuzzChannelId": null
        }
    })
}

fn prepare_body(channel_id: Uuid, source: &Event, name: &str) -> Value {
    json!({
        "channelId": channel_id,
        "triggeringEventId": source.id.to_hex(),
        "command": branch_command(name)
    })
}

fn stream_event(keys: &Keys, channel_id: Uuid, content: &str) -> Event {
    EventBuilder::new(Kind::Custom(9), content)
        .tags([Tag::parse(["h", &channel_id.to_string()]).expect("h tag")])
        .sign_with_keys(keys)
        .expect("sign stream event")
}

fn kickoff_task(keys: &Keys, channel_id: Uuid, fizz: &Keys) -> Event {
    EventBuilder::new(
        Kind::Custom(buzz_core::kind::KIND_AIRHOP_AGENT_TASK as u16),
        "Introduce the Airhop team in Russian.",
    )
    .tags([
        Tag::parse(["h", &channel_id.to_string()]).expect("h tag"),
        Tag::parse(["p", &fizz.public_key().to_hex()]).expect("p tag"),
        Tag::parse(["airhop-task", &Uuid::new_v4().to_string()]).expect("task tag"),
        Tag::parse(["airhop-kickoff-stage", "fizz_intro"]).expect("kickoff tag"),
    ])
    .sign_with_keys(keys)
    .expect("sign kickoff task")
}

fn reaction(keys: &Keys, channel_id: Uuid, target: &str) -> Event {
    EventBuilder::new(Kind::Reaction, "✅")
        .tags([
            Tag::parse(["h", &channel_id.to_string()]).expect("h tag"),
            Tag::parse(["e", target]).expect("e tag"),
            Tag::parse(["nonce", &Uuid::new_v4().to_string()]).expect("nonce tag"),
        ])
        .sign_with_keys(keys)
        .expect("sign reaction")
}

fn assert_success(status: StatusCode, body: &Value, operation: &str) {
    assert!(
        status.is_success(),
        "{operation} failed with {status}: {body}"
    );
}

#[tokio::test]
#[ignore = "requires the isolated relay, Postgres, Redis, and MinIO harness"]
async fn welcome_team_routes_one_agent_and_commits_only_authentic_preview_once() {
    let pool = db_pool().await;
    let run_id = Uuid::new_v4().simple().to_string();
    let primary_host = format!("airhop-e2e-a-{run_id}.test:3030");
    let secondary_host = format!("airhop-e2e-b-{run_id}.test:3030");
    let owner = Keys::generate();
    let attacker = Keys::generate();
    let agents_a = std::array::from_fn(|_| Keys::generate());
    let agents_b = std::array::from_fn(|_| Keys::generate());
    let organization_id = Uuid::new_v4();
    let channel_id = Uuid::new_v4();

    let community_a = seed_tenant(
        &pool,
        &primary_host,
        Uuid::new_v4(),
        organization_id,
        channel_id,
        TenantIdentities {
            owner: &owner,
            agents: &agents_a,
            attacker: &attacker,
        },
    )
    .await;
    let community_b = seed_tenant(
        &pool,
        &secondary_host,
        Uuid::new_v4(),
        organization_id,
        channel_id,
        TenantIdentities {
            owner: &owner,
            agents: &agents_b,
            attacker: &attacker,
        },
    )
    .await;
    assert_ne!(community_a, community_b);

    for (host, agents) in [
        (primary_host.as_str(), &agents_a),
        (secondary_host.as_str(), &agents_b),
    ] {
        let body = team_body(organization_id, channel_id, agents);
        let (status, response) = api_json(
            &owner,
            host,
            Method::PUT,
            "/api/airhop/agents/v1/welcome-team",
            Some(&body),
        )
        .await;
        assert_success(status, &response, "register Welcome team");
        assert_eq!(response["channelId"], channel_id.to_string());
        assert_eq!(
            response["members"]["administrator"],
            agents[1].public_key().to_hex()
        );
    }

    // Desktop-managed agents join channels as bots and authenticate to the relay
    // through the owner's NIP-OA delegation; they are not direct relay_members.
    let delegated_agent = &agents_a[3];
    sqlx::query("DELETE FROM relay_members WHERE community_id = $1 AND pubkey = $2")
        .bind(community_a)
        .bind(delegated_agent.public_key().to_hex())
        .execute(&pool)
        .await
        .expect("remove synthetic direct membership from delegated agent");
    let delegated_auth_tag =
        buzz_sdk::nip_oa::compute_auth_tag(&owner, &delegated_agent.public_key(), "")
            .expect("compute managed-agent NIP-OA auth tag");
    let (status, delegated_manifest) = api_json_with_auth_tag(
        delegated_agent,
        &primary_host,
        Method::GET,
        "/api/airhop/agents/v1/welcome-team",
        None,
        Some(&delegated_auth_tag),
    )
    .await;
    assert_success(
        status,
        &delegated_manifest,
        "delegated agent reads manifest",
    );
    assert_eq!(
        delegated_manifest["members"]["content_marketer"],
        delegated_agent.public_key().to_hex()
    );

    let kickoff = kickoff_task(&owner, channel_id, &agents_a[0]);
    let kickoff_status = submit_event(&primary_host, &kickoff).await;
    assert!(
        kickoff_status.is_success(),
        "Desktop HTTP submit must accept Airhop kickoff tasks, got {kickoff_status}"
    );
    let stored_kickoff_count: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM events
         WHERE community_id = $1 AND id = $2",
    )
    .bind(community_a)
    .bind(kickoff.id.as_bytes().as_slice())
    .fetch_one(&pool)
    .await
    .expect("count stored kickoff tasks");
    assert_eq!(stored_kickoff_count, 0, "kickoff task must stay ephemeral");

    let source = stream_event(&owner, channel_id, "Админ, добавь филиал Центр");
    assert!(submit_event(&primary_host, &source).await.is_success());
    assert!(submit_event(&secondary_host, &source).await.is_success());

    let claim_path = format!("/api/airhop/agents/v1/routes/{}/claim", source.id.to_hex());
    let (status, first_claim) =
        api_json(&agents_a[1], &primary_host, Method::POST, &claim_path, None).await;
    assert_success(status, &first_claim, "first route claim");
    assert_eq!(first_claim["targetRole"], "administrator");
    assert_eq!(
        first_claim["targetPubkey"],
        agents_a[1].public_key().to_hex()
    );
    assert_eq!(first_claim["reason"], "natural_role");
    assert_eq!(first_claim["replayed"], false);

    let (status, replayed_claim) =
        api_json(&agents_a[0], &primary_host, Method::POST, &claim_path, None).await;
    assert_success(status, &replayed_claim, "replayed route claim");
    assert_eq!(
        replayed_claim["targetPubkey"],
        agents_a[1].public_key().to_hex()
    );
    assert_eq!(replayed_claim["replayed"], true);

    let (status, tenant_b_claim) = api_json(
        &agents_b[1],
        &secondary_host,
        Method::POST,
        &claim_path,
        None,
    )
    .await;
    assert_success(status, &tenant_b_claim, "tenant B route claim");
    assert_eq!(
        tenant_b_claim["targetPubkey"],
        agents_b[1].public_key().to_hex()
    );
    let route_counts: Vec<(Uuid, i64)> = sqlx::query(
        "SELECT community_id, count(*)::bigint AS count
         FROM airhop_welcome_routes WHERE event_id = $1
         GROUP BY community_id ORDER BY community_id",
    )
    .bind(source.id.as_bytes().as_slice())
    .fetch_all(&pool)
    .await
    .expect("count tenant routes")
    .into_iter()
    .map(|row| (row.get("community_id"), row.get("count")))
    .collect();
    assert_eq!(route_counts.len(), 2);
    assert!(route_counts.iter().all(|(_, count)| *count == 1));

    let prepare_path = "/api/airhop/agents/v1/actions/prepare";
    let first_body = prepare_body(channel_id, &source, "Центр черновик");
    let (status, first_action) = api_json(
        &agents_a[1],
        &primary_host,
        Method::POST,
        prepare_path,
        Some(&first_body),
    )
    .await;
    assert_success(status, &first_action, "prepare first action");
    assert_eq!(first_action["status"], "pending");
    let first_action_id = Uuid::parse_str(first_action["actionId"].as_str().unwrap()).unwrap();
    let first_preview = first_action["previewEventId"].as_str().unwrap().to_owned();

    let (status, retry_action) = api_json(
        &agents_a[1],
        &primary_host,
        Method::POST,
        prepare_path,
        Some(&first_body),
    )
    .await;
    assert_success(status, &retry_action, "retry first action");
    assert_eq!(retry_action["actionId"], first_action["actionId"]);
    assert_eq!(
        retry_action["previewEventId"],
        first_action["previewEventId"]
    );
    assert_eq!(retry_action["replayed"], true);

    let digest: Vec<u8> = sqlx::query_scalar(
        "SELECT command_digest FROM airhop_agent_actions
         WHERE community_id = $1 AND id = $2",
    )
    .bind(community_a)
    .bind(first_action_id)
    .fetch_one(&pool)
    .await
    .expect("read action digest");
    let fake_preview = EventBuilder::new(Kind::Custom(9), "Поддельное подтверждение")
        .tags([
            Tag::parse(["h", &channel_id.to_string()]).unwrap(),
            Tag::parse([
                "airhop-action",
                &organization_id.to_string(),
                &first_action_id.to_string(),
                "1",
                &hex::encode(digest),
            ])
            .unwrap(),
        ])
        .sign_with_keys(&attacker)
        .expect("sign fake preview");
    assert!(submit_event(&primary_host, &fake_preview)
        .await
        .is_success());
    assert!(submit_event(
        &primary_host,
        &reaction(&owner, channel_id, &fake_preview.id.to_hex())
    )
    .await
    .is_success());
    let branch_count: i64 =
        sqlx::query_scalar("SELECT count(*)::bigint FROM airhop_branches WHERE community_id = $1")
            .bind(community_a)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        branch_count, 0,
        "fake relay-looking card mutated Booking Core"
    );

    let corrected_body = prepare_body(channel_id, &source, "Центр");
    let (status, corrected_action) = api_json(
        &agents_a[1],
        &primary_host,
        Method::POST,
        prepare_path,
        Some(&corrected_body),
    )
    .await;
    assert_success(status, &corrected_action, "prepare corrected action");
    let corrected_preview = corrected_action["previewEventId"]
        .as_str()
        .unwrap()
        .to_owned();
    let first_status: String = sqlx::query_scalar(
        "SELECT status FROM airhop_agent_actions WHERE community_id = $1 AND id = $2",
    )
    .bind(community_a)
    .bind(first_action_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(first_status, "cancelled");

    let stale_status =
        submit_event(&primary_host, &reaction(&owner, channel_id, &first_preview)).await;
    assert!(
        stale_status.is_client_error(),
        "superseded preview must fail closed, got {stale_status}"
    );

    let confirm = reaction(&owner, channel_id, &corrected_preview);
    assert!(submit_event(&primary_host, &confirm).await.is_success());
    let duplicate_confirm = reaction(&owner, channel_id, &corrected_preview);
    assert!(submit_event(&primary_host, &duplicate_confirm)
        .await
        .is_success());

    let branches: i64 = sqlx::query_scalar(
        "SELECT count(*)::bigint FROM airhop_branches
         WHERE community_id = $1 AND organization_id = $2 AND name = 'Центр'",
    )
    .bind(community_a)
    .bind(organization_id)
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(branches, 1, "duplicate ✅ created a second branch");

    let action_row = sqlx::query(
        "SELECT initiator_pubkey, prepared_by_agent_pubkey, confirmed_by_pubkey, status
         FROM airhop_agent_actions WHERE community_id = $1 AND id = $2",
    )
    .bind(community_a)
    .bind(Uuid::parse_str(corrected_action["actionId"].as_str().unwrap()).unwrap())
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(action_row.get::<String, _>("status"), "committed");
    assert_eq!(
        action_row.get::<Vec<u8>, _>("initiator_pubkey"),
        owner.public_key().to_bytes()
    );
    assert_eq!(
        action_row.get::<Vec<u8>, _>("prepared_by_agent_pubkey"),
        agents_a[1].public_key().to_bytes()
    );
    assert_eq!(
        action_row.get::<Vec<u8>, _>("confirmed_by_pubkey"),
        owner.public_key().to_bytes()
    );
    let audit = sqlx::query(
        "SELECT actor_kind, actor_pubkey, on_behalf_of_pubkey, agent_pubkey
         FROM airhop_domain_events
         WHERE community_id = $1 AND organization_id = $2
           AND actor_kind = 'bot' ORDER BY recorded_at DESC LIMIT 1",
    )
    .bind(community_a)
    .bind(organization_id)
    .fetch_one(&pool)
    .await
    .expect("read Booking Core audit event");
    assert_eq!(audit.get::<String, _>("actor_kind"), "bot");
    assert_eq!(
        audit.get::<Vec<u8>, _>("actor_pubkey"),
        agents_a[1].public_key().to_bytes()
    );
    assert_eq!(
        audit.get::<Vec<u8>, _>("agent_pubkey"),
        agents_a[1].public_key().to_bytes()
    );
    assert_eq!(
        audit.get::<Vec<u8>, _>("on_behalf_of_pubkey"),
        owner.public_key().to_bytes()
    );

    let tenant_b_body = prepare_body(channel_id, &source, "Центр tenant B");
    let (status, tenant_b_action) = api_json(
        &agents_b[1],
        &secondary_host,
        Method::POST,
        prepare_path,
        Some(&tenant_b_body),
    )
    .await;
    assert_success(status, &tenant_b_action, "prepare tenant B action");
    assert_eq!(tenant_b_action["status"], "pending");
    let tenant_b_branches: i64 =
        sqlx::query_scalar("SELECT count(*)::bigint FROM airhop_branches WHERE community_id = $1")
            .bind(community_b)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(
        tenant_b_branches, 0,
        "tenant A confirmation leaked into tenant B"
    );
}
