#!/usr/bin/env bash
# Runs the current AirHop native application against a newly migrated, seeded
# relay. The desktop build is deliberately last so Rust tests/backend builds
# cannot replace the WebDriver-enabled application artifact.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"
PG_PORT="${AIRHOP_HARNESS_PG_PORT:-5471}"
REDIS_PORT="${AIRHOP_HARNESS_REDIS_PORT:-6471}"
MINIO_PORT="${AIRHOP_HARNESS_MINIO_PORT:-9471}"
RELAY_PORT="${AIRHOP_HARNESS_RELAY_PORT:-3030}"
HEALTH_PORT="${AIRHOP_HARNESS_HEALTH_PORT:-18088}"
METRICS_PORT="${AIRHOP_HARNESS_METRICS_PORT:-19202}"
FAKE_LLM_PORT="${AIRHOP_E2E_FAKE_LLM_PORT:-45781}"
CARGO_TARGET_PROFILE="debug"
OWNER_PUBKEY="e5ebc6cdb579be112e336cc319b5989b4bb6af11786ea90dbe52b5f08d741b34"
RELAY_PRIVATE_KEY="0000000000000000000000000000000000000000000000000000000000000001"
ORGANIZATION_ID="00000000-0000-4000-8000-00000000a123"
INSTALLATION_ID="00000000-0000-4000-8000-00000000a124"
GRANT_ID="00000000-0000-4000-8000-00000000a125"
COMMUNITY_HOST="localhost:${RELAY_PORT}"
ACTIVATION_CODE="$(node ./scripts/airhop-e2e-activation-fixture.mjs code)"
RELAY_PID=""; FAKE_LLM_PID=""; GUEST_PID=""
GUEST_PRIVATE_KEY="0000000000000000000000000000000000000000000000000000000000000002"
GUEST_PUBKEY="$(node --input-type=module -e 'import {createRequire} from "node:module"; const require=createRequire(process.cwd()+"/desktop/package.json"); console.log(require("nostr-tools").getPublicKey(Uint8Array.from(Buffer.from(process.argv[1],"hex"))));' "${GUEST_PRIVATE_KEY}")"
RELAY_LOG="${AIRHOP_E2E_RELAY_LOG:-/private/tmp/airhop-welcome-e2e-relay.log}"
FAKE_LLM_LOG="${AIRHOP_E2E_FAKE_LLM_LOG:-/private/tmp/airhop-welcome-e2e-llm.log}"
SCREENSHOT_PATH="${AIRHOP_E2E_SCREENSHOT_PATH:-/private/tmp/airhop-welcome-native.png}"
LIVE_PROBE=false
SETUP_PROBE=false
if [[ -n "${AIRHOP_E2E_PROVIDER_CONFIG:-}" ]]; then LIVE_PROBE=true; fi
if [[ "${AIRHOP_E2E_SETUP_PROBE:-0}" == "1" ]]; then SETUP_PROBE=true; fi

cleanup() {
  local status=$?
  trap - EXIT INT TERM
  if [[ -n "${GUEST_PID}" ]]; then kill "${GUEST_PID}" 2>/dev/null || true; wait "${GUEST_PID}" 2>/dev/null || true; fi
  if [[ -n "${RELAY_PID}" ]]; then kill "${RELAY_PID}" 2>/dev/null || true; wait "${RELAY_PID}" 2>/dev/null || true; fi
  if [[ -n "${FAKE_LLM_PID}" ]]; then kill "${FAKE_LLM_PID}" 2>/dev/null || true; wait "${FAKE_LLM_PID}" 2>/dev/null || true; fi
  exit "${status}"
}
trap cleanup EXIT INT TERM

refuse_occupied_port() {
  local port="$1"
  if command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"${port}" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "Port ${port} is already in use; refusing to reuse stale E2E services." >&2
    lsof -nP -iTCP:"${port}" -sTCP:LISTEN >&2 || true
    exit 1
  fi
}
wait_for_http() {
  local url="$1" label="$2"
  for _ in $(seq 1 60); do
    if curl -fsS "${url}" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  echo "${label} did not become ready at ${url}." >&2
  exit 1
}
refuse_occupied_port "${RELAY_PORT}"
refuse_occupied_port "${FAKE_LLM_PORT}"

echo "[airhop-native-e2e] Preparing clean AirHop data and current relay..."
# Build both together so migration and relay setup use the same toolchain and
# Cargo feature set; separate cargo run/build repeatedly invalidated the cache.
cargo build --locked -p buzz-admin -p buzz-relay
AIRHOP_HARNESS_PG_PORT="${PG_PORT}" AIRHOP_HARNESS_REDIS_PORT="${REDIS_PORT}" \
AIRHOP_HARNESS_MINIO_PORT="${MINIO_PORT}" AIRHOP_HARNESS_RELAY_PORT="${RELAY_PORT}" \
AIRHOP_HARNESS_HEALTH_PORT="${HEALTH_PORT}" AIRHOP_HARNESS_METRICS_PORT="${METRICS_PORT}" \
  ./scripts/start-isolated-test-relay.sh --prepare-only --profile dev --prebuilt

COMMUNITY_ID="$(docker compose -p buzz-harness -f docker-compose.harness.yml exec -T postgres psql -U buzz -d buzz -Atc "SELECT id FROM communities WHERE lower(host) = lower('${COMMUNITY_HOST}') LIMIT 1")"
CODE_DIGEST_HEX="$(node ./scripts/airhop-e2e-activation-fixture.mjs digest "${RELAY_PRIVATE_KEY}" "${COMMUNITY_ID}" "${ACTIVATION_CODE}")"
echo "[airhop-native-e2e] Seeding the AirHop organization and one-time owner grant..."
docker compose -p buzz-harness -f docker-compose.harness.yml exec -T postgres \
  psql -U buzz -d buzz -v ON_ERROR_STOP=1 <<SQL
INSERT INTO airhop_organizations (community_id, id, name, locale, time_zone, default_trial_policy)
SELECT id, '${ORGANIZATION_ID}', 'AirHop E2E Center', 'ru-RU', 'Europe/Moscow', '{"mode":"free"}'::jsonb
FROM communities WHERE lower(host) = lower('${COMMUNITY_HOST}')
ON CONFLICT (community_id) DO UPDATE SET name = EXCLUDED.name, locale = EXCLUDED.locale,
  time_zone = EXCLUDED.time_zone, default_trial_policy = EXCLUDED.default_trial_policy, status = 'active';
INSERT INTO airhop_center_installations (
  community_id, organization_id, id, environment, release_profile, release_version
) VALUES (
  '${COMMUNITY_ID}', '${ORGANIZATION_ID}', '${INSTALLATION_ID}',
  'development', 'native-e2e', 'task12-current'
);
INSERT INTO airhop_center_activation_grants (
  community_id, organization_id, id, installation_id, code_digest,
  issue_idempotency_digest, issue_request_hash, issued_by_pubkey, expires_at
) VALUES (
  '${COMMUNITY_ID}', '${ORGANIZATION_ID}', '${GRANT_ID}', '${INSTALLATION_ID}',
  decode('${CODE_DIGEST_HEX}', 'hex'), decode(repeat('11', 32), 'hex'),
  decode(repeat('22', 32), 'hex'), decode('${OWNER_PUBKEY}', 'hex'), now() + interval '1 hour'
);
INSERT INTO airhop_center_activation_audit (
  community_id, organization_id, installation_id, grant_id, event_type,
  actor_kind, actor_pubkey, payload
) VALUES (
  '${COMMUNITY_ID}', '${ORGANIZATION_ID}', '${INSTALLATION_ID}', '${GRANT_ID}',
  'airhop.center.activation-grant-issued.v1', 'operator',
  decode('${OWNER_PUBKEY}', 'hex'), '{"environment":"development","fixture":"native-e2e"}'::jsonb
);
INSERT INTO users(community_id,pubkey,agent_type,display_name)
VALUES('${COMMUNITY_ID}',decode('${GUEST_PUBKEY}','hex'),'managed-agent','Гермес');
INSERT INTO relay_members(community_id,pubkey,role)
VALUES('${COMMUNITY_ID}','${GUEST_PUBKEY}','member');
INSERT INTO airhop_agent_deployments(
  community_id,organization_id,id,blueprint_key,blueprint_version,role,
  agent_pubkey,profile_ref,runtime_revision,persona_revision,skills_revision,
  model_revision,registered_by_pubkey
) VALUES (
  '${COMMUNITY_ID}','${ORGANIZATION_ID}','00000000-0000-4000-8000-00000000a126',
  'airhop.hermes.parent_administrator',1,'parent_administrator',
  decode('${GUEST_PUBKEY}','hex'),'native-e2e','native-e2e','native-e2e',
  'native-e2e','fake-airhop-e2e',decode('${OWNER_PUBKEY}','hex')
);
SQL

echo "[airhop-native-e2e] Building and bundling current agent sidecars..."
cargo build --release --locked -p buzz-acp -p buzz-agent -p buzz-dev-mcp -p buzz-cli
bash scripts/bundle-sidecars.sh

echo "[airhop-native-e2e] Starting current relay and deterministic LLM..."
DATABASE_URL="postgres://buzz:buzz_dev@localhost:${PG_PORT}/buzz" \
REDIS_URL="redis://localhost:${REDIS_PORT}" RELAY_URL="ws://localhost:${RELAY_PORT}" \
BUZZ_BIND_ADDR="0.0.0.0:${RELAY_PORT}" BUZZ_HEALTH_PORT="${HEALTH_PORT}" \
BUZZ_METRICS_PORT="${METRICS_PORT}" BUZZ_S3_ENDPOINT="http://localhost:${MINIO_PORT}" \
BUZZ_S3_ACCESS_KEY="buzz_dev" BUZZ_S3_SECRET_KEY="buzz_dev_secret" BUZZ_S3_BUCKET="buzz-media" \
BUZZ_REQUIRE_RELAY_MEMBERSHIP=true \
RELAY_OWNER_PUBKEY="${OWNER_PUBKEY}" \
BUZZ_RELAY_PRIVATE_KEY="${RELAY_PRIVATE_KEY}" \
BUZZ_ALLOW_NIP_OA_AUTH=true \
BUZZ_REQUIRE_AUTH_TOKEN=false BUZZ_RECONCILE_CHANNELS=true \
  "./target/${CARGO_TARGET_PROFILE}/buzz-relay" >"${RELAY_LOG}" 2>&1 &
RELAY_PID=$!
AIRHOP_E2E_FAKE_LLM_PORT="${FAKE_LLM_PORT}" \
  node ./scripts/airhop-e2e-fake-llm.mjs >"${FAKE_LLM_LOG}" 2>&1 &
FAKE_LLM_PID=$!
wait_for_http "http://localhost:${RELAY_PORT}/info" "Relay"
wait_for_http "http://127.0.0.1:${FAKE_LLM_PORT}/debug" "Fake LLM"

echo "[airhop-native-e2e] Building the exact current AirHop desktop application..."
(cd desktop; pnpm build:e2e:tauri)
# The fifth introduction comes from the real ACP host loop under a separate
# identity with no Welcome membership. No parent LLM is involved in this stage.
BUZZ_RELAY_URL="ws://localhost:${RELAY_PORT}" BUZZ_PRIVATE_KEY="${GUEST_PRIVATE_KEY}" \
BUZZ_AIRHOP_ROLE=parent_administrator BUZZ_AIRHOP_CONTEXT_GRANT=native-e2e-unused \
BUZZ_ACP_AGENT_COMMAND="${REPO_ROOT}/desktop/src-tauri/target/debug/buzz-agent" \
BUZZ_ACP_AGENT_ARGS="" BUZZ_ACP_SUBSCRIBE=all BUZZ_ACP_NO_MENTION_FILTER=true \
BUZZ_ACP_RESPOND_TO=anyone BUZZ_ACP_NO_MEMORY=true BUZZ_ACP_HEARTBEAT_INTERVAL=0 \
BUZZ_AGENT_PROVIDER=openai OPENAI_COMPAT_API_KEY=airhop-e2e \
OPENAI_COMPAT_MODEL=fake-airhop-e2e OPENAI_COMPAT_API=chat \
OPENAI_COMPAT_BASE_URL="http://127.0.0.1:${FAKE_LLM_PORT}/v1" \
  ./desktop/src-tauri/target/debug/buzz-acp >/private/tmp/airhop-welcome-e2e-guest.log 2>&1 &
GUEST_PID=$!
echo "[airhop-native-e2e] Running native Welcome flow against clean data..."
(
  cd desktop
  for resume in 0 1; do
  AIRHOP_E2E_RESUME="${resume}" BUZZ_RELAY_URL="ws://localhost:${RELAY_PORT}" \
  AIRHOP_E2E_FAKE_LLM_URL="http://127.0.0.1:${FAKE_LLM_PORT}/v1" \
  AIRHOP_E2E_ACTIVATION_CODE="${ACTIVATION_CODE}" \
  AIRHOP_E2E_SCREENSHOT_PATH="${SCREENSHOT_PATH}" \
    pnpm exec wdio run wdio.conf.ts
  done
)
echo "[airhop-native-e2e] Checking persisted receipts and isolated guest permissions..."
docker compose -p buzz-harness -f docker-compose.harness.yml exec -T postgres \
  psql -U buzz -d buzz -v ON_ERROR_STOP=1 <<SQL
DO \$\$
DECLARE welcome UUID; owner_message BYTEA; replies INTEGER;
BEGIN
  SELECT channel_id INTO STRICT welcome FROM airhop_welcome_teams
    WHERE community_id='${COMMUNITY_ID}';
  IF (SELECT count(*) FROM events WHERE community_id='${COMMUNITY_ID}'
    AND channel_id=welcome AND kind=9 AND tags @> '[["airhop-kickoff-stage","hermes_guest_intro"]]'::jsonb) <> 1
    THEN RAISE EXCEPTION 'Expected exactly one Hermes greeting'; END IF;
  IF EXISTS(SELECT 1 FROM channel_members WHERE community_id='${COMMUNITY_ID}'
    AND channel_id=welcome AND pubkey=decode('${GUEST_PUBKEY}','hex') AND removed_at IS NULL)
    THEN RAISE EXCEPTION 'Guest must not acquire channel membership'; END IF;
  IF ${LIVE_PROBE:-false} THEN
    IF ${SETUP_PROBE:-false} THEN
      IF (SELECT count(*) FROM airhop_branches WHERE community_id='${COMMUNITY_ID}'
          AND name='Проверочный филиал')<>1
        OR (SELECT count(*) FROM airhop_agent_actions WHERE community_id='${COMMUNITY_ID}'
          AND status='committed')<>1 THEN
        RAISE EXCEPTION 'Expected exactly one explicitly confirmed setup action';
      END IF;
      RETURN;
    END IF;
    IF EXISTS(SELECT 1 FROM airhop_branches WHERE community_id='${COMMUNITY_ID}')
      OR EXISTS(SELECT 1 FROM airhop_teachers WHERE community_id='${COMMUNITY_ID}')
      THEN RAISE EXCEPTION 'Read/skip/pause probes must not modify organization setup'; END IF;
    RETURN;
  END IF;
  SELECT id INTO STRICT owner_message FROM events WHERE community_id='${COMMUNITY_ID}'
    AND channel_id=welcome AND kind=9 AND content='Проверка связи без упоминания';
  IF EXISTS(SELECT 1 FROM events e, jsonb_array_elements(e.tags) tag
    WHERE e.community_id='${COMMUNITY_ID}' AND e.id=owner_message AND tag->>0='p')
    THEN RAISE EXCEPTION 'Owner test message must have no mention'; END IF;
  SELECT count(*) INTO replies FROM events e JOIN airhop_welcome_teams t
    ON t.community_id=e.community_id AND t.channel_id=e.channel_id AND t.fizz_pubkey=e.pubkey
    WHERE e.community_id='${COMMUNITY_ID}' AND e.kind=9
    AND e.tags @> jsonb_build_array(jsonb_build_array('airhop-responds-to',encode(owner_message,'hex')));
  IF replies <> 1 THEN RAISE EXCEPTION 'Expected one durable Fizz response acknowledgement, got %', replies; END IF;
  SELECT id INTO STRICT owner_message FROM events WHERE community_id='${COMMUNITY_ID}'
    AND channel_id=welcome AND kind=9 AND content='Проверка связи после перезапуска';
  SELECT count(*) INTO replies FROM events e JOIN airhop_welcome_teams t
    ON t.community_id=e.community_id AND t.channel_id=e.channel_id AND t.fizz_pubkey=e.pubkey
    WHERE e.community_id='${COMMUNITY_ID}' AND e.kind=9
    AND e.tags @> jsonb_build_array(jsonb_build_array('airhop-responds-to',encode(owner_message,'hex')));
  IF replies <> 1 THEN RAISE EXCEPTION 'Expected one response after process restart, got %', replies; END IF;
END \$\$;
SQL
echo "[airhop-native-e2e] PASS — screenshot: ${SCREENSHOT_PATH}"
