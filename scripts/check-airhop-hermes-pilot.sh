#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${AIRHOP_ENV_FILE:-${REPO_ROOT}/deploy/airhop/.env}"
COMPOSE_FILE="${AIRHOP_COMPOSE_FILE:-${REPO_ROOT}/deploy/airhop/compose.yml}"
COMPOSE_FILES="${AIRHOP_COMPOSE_FILES:-${COMPOSE_FILE}}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "AirHop environment file not found: ${ENV_FILE}" >&2
  exit 1
fi

read_env() {
  local name="$1"
  sed -n "s/^${name}=//p" "${ENV_FILE}" | tail -n 1
}

IFS=':' read -r -a compose_file_paths <<<"${COMPOSE_FILES}"
compose=(docker compose --env-file "${ENV_FILE}")
for compose_file_path in "${compose_file_paths[@]}"; do
  if [[ ! -f "${compose_file_path}" ]]; then
    echo "AirHop Compose file not found: ${compose_file_path}" >&2
    exit 1
  fi
  compose+=(-f "${compose_file_path}")
done
compose+=(--profile hermes --profile telegram)

relay_url="$(read_env RELAY_URL)"
community_host="${AIRHOP_DEMO_HOST:-${relay_url#ws://}}"
community_host="${community_host#wss://}"
community_host="${community_host%%/*}"
postgres_user="$(read_env POSTGRES_USER)"
postgres_database="$(read_env POSTGRES_DB)"
postgres_user="${postgres_user:-airhop}"
postgres_database="${postgres_database:-airhop}"

if [[ -z "${community_host}" || "${community_host}" == *"CHANGE_ME"* ]]; then
  echo "Set a concrete RELAY_URL or AIRHOP_DEMO_HOST." >&2
  exit 1
fi

AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" config --quiet

running_services="$(AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" ps --status running --services)"
for service in relay postgres redis minio hermes-parent-runtime telegram-gateway; do
  if ! grep -Fxq "${service}" <<<"${running_services}"; then
    echo "Required service is not running: ${service}" >&2
    exit 1
  fi
done

deployment_status="$({
  AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" exec -T postgres \
    psql -X -qAt \
      -U "${postgres_user}" \
      -d "${postgres_database}" \
      -v community_host="${community_host}" \
      -f /dev/stdin <<'SQL'
SELECT CASE
  WHEN count(*) = 1
   AND bool_and(deployment.enabled)
   AND bool_and(NOT deployment.paused)
   AND bool_and(deployment.role = 'parent_administrator')
  THEN 'ready'
  ELSE 'not_ready'
END
FROM airhop_agent_deployments deployment
JOIN communities community ON community.id = deployment.community_id
JOIN airhop_organizations organization
  ON organization.community_id = deployment.community_id
 AND organization.id = deployment.organization_id
WHERE lower(community.host) = lower(:'community_host')
  AND organization.status = 'active'
  AND deployment.role = 'parent_administrator';
SQL
} | tail -n 1)"
if [[ "${deployment_status}" != "ready" ]]; then
  echo "Hermes deployment is not enabled and ready for ${community_host}." >&2
  exit 1
fi

telegram_status="$({
  AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" exec -T postgres \
    psql -X -qAt \
      -U "${postgres_user}" \
      -d "${postgres_database}" \
      -v community_host="${community_host}" \
      -f /dev/stdin <<'SQL'
SELECT CASE
  WHEN count(*) FILTER (
    WHERE connection.status = 'active'
      AND connection.hermes_enabled
      AND connection.observed_status = 'ready'
      AND connection.last_heartbeat_at > now() - interval '2 minutes'
  ) > 0
  THEN 'ready'
  ELSE 'not_ready'
END
FROM airhop_channel_connections connection
JOIN communities community ON community.id = connection.community_id
WHERE lower(community.host) = lower(:'community_host')
  AND connection.provider = 'telegram';
SQL
} | tail -n 1)"
if [[ "${telegram_status}" != "ready" ]]; then
  echo "No active Telegram connection has a fresh ready heartbeat." >&2
  exit 1
fi

AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" exec -T hermes-parent-runtime \
  python -c 'import os; from acp_adapter.session import _expand_acp_enabled_toolsets; assert os.environ.get("HERMES_ACP_BUILTIN_TOOLSETS") == ""; assert _expand_acp_enabled_toolsets([], ["airhop-agent-mcp"]) == ["mcp-airhop-agent-mcp"]'

AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" exec -T hermes-parent-runtime \
  sh -ec 'test -n "$DEEPSEEK_API_KEY"; test -n "$BUZZ_PRIVATE_KEY"; for name in AIRHOP_TELEGRAM_BOT_TOKEN AIRHOP_TELEGRAM_CONNECTOR_SECRET_KEY POSTGRES_PASSWORD REDIS_PASSWORD BUZZ_S3_SECRET_KEY; do eval "test -z \"\${$name:-}\""; done'
AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" exec -T telegram-gateway \
  sh -ec 'test -n "$AIRHOP_CONNECTOR_SECRET_KEY"; for name in DEEPSEEK_API_KEY AIRHOP_HERMES_AGENT_SECRET_KEY POSTGRES_PASSWORD REDIS_PASSWORD BUZZ_S3_SECRET_KEY; do eval "test -z \"\${$name:-}\""; done'
AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" exec -T relay \
  sh -ec 'for name in DEEPSEEK_API_KEY AIRHOP_HERMES_AGENT_SECRET_KEY AIRHOP_TELEGRAM_CONNECTOR_SECRET_KEY AIRHOP_TELEGRAM_BOT_TOKEN AIRHOP_TELEGRAM_WEBHOOK_SECRET; do eval "test -z \"\${$name:-}\""; done'

echo "AirHop Hermes pilot infrastructure is ready for a real Telegram conversation."
echo "Send a private message to the connected bot, then verify that one private Buzz conversation appears and Hermes replies in the same Telegram chat."
