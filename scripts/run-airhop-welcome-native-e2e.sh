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
RELAY_PID=""; FAKE_LLM_PID=""
RELAY_LOG="${AIRHOP_E2E_RELAY_LOG:-/private/tmp/airhop-welcome-e2e-relay.log}"
FAKE_LLM_LOG="${AIRHOP_E2E_FAKE_LLM_LOG:-/private/tmp/airhop-welcome-e2e-llm.log}"
SCREENSHOT_PATH="${AIRHOP_E2E_SCREENSHOT_PATH:-/private/tmp/airhop-welcome-native.png}"

cleanup() {
  local status=$?
  trap - EXIT INT TERM
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
AIRHOP_HARNESS_PG_PORT="${PG_PORT}" AIRHOP_HARNESS_REDIS_PORT="${REDIS_PORT}" \
AIRHOP_HARNESS_MINIO_PORT="${MINIO_PORT}" AIRHOP_HARNESS_RELAY_PORT="${RELAY_PORT}" \
AIRHOP_HARNESS_HEALTH_PORT="${HEALTH_PORT}" AIRHOP_HARNESS_METRICS_PORT="${METRICS_PORT}" \
  ./scripts/start-isolated-test-relay.sh --prepare-only --profile dev

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
SQL

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
echo "[airhop-native-e2e] Running native Welcome flow against clean data..."
(
  cd desktop
  BUZZ_RELAY_URL="ws://localhost:${RELAY_PORT}" \
  AIRHOP_E2E_FAKE_LLM_URL="http://127.0.0.1:${FAKE_LLM_PORT}/v1" \
  AIRHOP_E2E_ACTIVATION_CODE="${ACTIVATION_CODE}" \
  AIRHOP_E2E_SCREENSHOT_PATH="${SCREENSHOT_PATH}" \
    pnpm exec wdio run wdio.conf.ts
)
echo "[airhop-native-e2e] PASS — screenshot: ${SCREENSHOT_PATH}"
