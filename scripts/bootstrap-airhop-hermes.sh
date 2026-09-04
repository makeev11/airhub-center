#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${AIRHOP_ENV_FILE:-${REPO_ROOT}/deploy/airhop/.env}"
COMPOSE_FILE="${AIRHOP_COMPOSE_FILE:-${REPO_ROOT}/deploy/airhop/compose.yml}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "AirHop environment file not found: ${ENV_FILE}" >&2
  exit 1
fi

read_env() {
  local name="$1"
  sed -n "s/^${name}=//p" "${ENV_FILE}" | tail -n 1
}

relay_url="$(read_env RELAY_URL)"
case "${relay_url}" in
  wss://*) public_http_url="https://${relay_url#wss://}" ;;
  ws://*) public_http_url="http://${relay_url#ws://}" ;;
  *)
    echo "RELAY_URL must use ws:// or wss://." >&2
    exit 1
    ;;
esac
public_http_url="${public_http_url%/}"
community_host="${AIRHOP_DEMO_HOST:-${relay_url#ws://}}"
community_host="${community_host#wss://}"
community_host="${community_host%%/*}"
agent_pubkey="$(read_env AIRHOP_HERMES_AGENT_PUBKEY)"
agent_secret_key="$(read_env AIRHOP_HERMES_AGENT_SECRET_KEY)"
connector_pubkey="$(read_env AIRHOP_TELEGRAM_CONNECTOR_PUBKEY)"
connector_secret_key="$(read_env AIRHOP_TELEGRAM_CONNECTOR_SECRET_KEY)"
owner_pubkey="$(read_env RELAY_OWNER_PUBKEY)"
deepseek_api_key="$(read_env DEEPSEEK_API_KEY)"
model_revision="$(read_env AIRHOP_HERMES_MODEL)"
model_revision="${model_revision:-deepseek-v4-flash}"
postgres_user="$(read_env POSTGRES_USER)"
postgres_database="$(read_env POSTGRES_DB)"
postgres_user="${postgres_user:-airhop}"
postgres_database="${postgres_database:-airhop}"

for pair in \
  "AIRHOP_HERMES_AGENT_PUBKEY:${agent_pubkey}" \
  "AIRHOP_TELEGRAM_CONNECTOR_PUBKEY:${connector_pubkey}" \
  "RELAY_OWNER_PUBKEY:${owner_pubkey}"; do
  variable_name="${pair%%:*}"
  variable_value="${pair#*:}"
  if [[ ! "${variable_value}" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "${variable_name} must be a concrete 64-character hex public key." >&2
    exit 1
  fi
done

for pair in \
  "AIRHOP_HERMES_AGENT_SECRET_KEY:${agent_secret_key}" \
  "AIRHOP_TELEGRAM_CONNECTOR_SECRET_KEY:${connector_secret_key}"; do
  variable_name="${pair%%:*}"
  variable_value="${pair#*:}"
  if [[ ! "${variable_value}" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "${variable_name} must be a concrete 64-character hex secret key." >&2
    exit 1
  fi
done

if [[ -z "${community_host}" || "${community_host}" == *"CHANGE_ME"* ]]; then
  echo "Set a concrete RELAY_URL or AIRHOP_DEMO_HOST." >&2
  exit 1
fi
if [[ -z "${deepseek_api_key}" || "${deepseek_api_key}" == *"CHANGE_ME"* ]]; then
  echo "Set a concrete DEEPSEEK_API_KEY." >&2
  exit 1
fi
if [[ ! "${model_revision}" =~ ^[a-zA-Z0-9._:/@+-]{1,120}$ ]]; then
  echo "AIRHOP_HERMES_MODEL contains unsupported characters." >&2
  exit 1
fi

compose=(docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}")

echo "Building the pinned Hermes runtime and Telegram gateway images..."
AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" --profile hermes --profile telegram build \
  hermes-parent-runtime telegram-gateway

derive_public_key='import os; from cryptography.hazmat.primitives.asymmetric import ec; name=os.environ["AIRHOP_KEY_ENV"]; secret=os.environ[name]; key=ec.derive_private_key(int(secret, 16), ec.SECP256K1()); print(key.public_key().public_numbers().x.to_bytes(32, "big").hex())'
derived_agent_pubkey="$(AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" --profile hermes run \
  --rm --no-deps --entrypoint python \
  -e AIRHOP_KEY_ENV=BUZZ_PRIVATE_KEY \
  hermes-parent-runtime -c "${derive_public_key}" | tail -n 1)"
derived_connector_pubkey="$(AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" --profile telegram run \
  --rm --no-deps --entrypoint python \
  -e AIRHOP_KEY_ENV=AIRHOP_CONNECTOR_SECRET_KEY \
  telegram-gateway -c "${derive_public_key}" | tail -n 1)"
if [[ "${derived_agent_pubkey}" != "${agent_pubkey,,}" ]]; then
  echo "AIRHOP_HERMES_AGENT_SECRET_KEY does not match AIRHOP_HERMES_AGENT_PUBKEY." >&2
  exit 1
fi
if [[ "${derived_connector_pubkey}" != "${connector_pubkey,,}" ]]; then
  echo "AIRHOP_TELEGRAM_CONNECTOR_SECRET_KEY does not match AIRHOP_TELEGRAM_CONNECTOR_PUBKEY." >&2
  exit 1
fi

echo "Registering the Hermes and Telegram connector principals..."
AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" exec -T relay \
  buzz-admin add-member --pubkey "${agent_pubkey}" --role member
AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" exec -T relay \
  buzz-admin add-member --pubkey "${connector_pubkey}" --role member

organization_locale="$({
  AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" exec -T postgres \
    psql -X -qAt \
      -U "${postgres_user}" \
      -d "${postgres_database}" \
      -v community_host="${community_host}" \
      -f /dev/stdin <<'SQL'
SELECT organization.locale
FROM airhop_organizations organization
JOIN communities community ON community.id = organization.community_id
WHERE lower(community.host) = lower(:'community_host')
  AND organization.status = 'active'
LIMIT 1;
SQL
} | tail -n 1)"
case "${organization_locale}" in
  pt-BR)
    profile_name="Administrador Hermes"
    profile_about="Administrador externo do centro. Conversa com responsáveis nos canais conectados."
    ;;
  en-US)
    profile_name="Administrator Hermes"
    profile_about="External center administrator. Talks with parents in connected channels."
    ;;
  tr-TR)
    profile_name="Yönetici Hermes"
    profile_about="Merkezin harici yöneticisi. Bağlı kanallarda velilerle konuşur."
    ;;
  ru-RU)
    profile_name="Администратор Гермес"
    profile_about="Внешний администратор центра. Общается с родителями в подключённых каналах."
    ;;
  *)
    echo "The active AirHop organization has an unsupported locale: ${organization_locale:-missing}." >&2
    exit 1
    ;;
esac

echo "Publishing the Hermes profile through the normal signed Buzz API..."
AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" --profile hermes run --rm --no-deps \
  --entrypoint buzz hermes-parent-runtime \
  users set-profile \
  --name "${profile_name}" \
  --avatar "${public_http_url}/agents/hermes.png" \
  --about "${profile_about}"

echo "Creating the initial organization-scoped Hermes deployment..."
AIRHOP_ENV_FILE="${ENV_FILE}" "${compose[@]}" exec -T postgres \
  psql \
    -U "${postgres_user}" \
    -d "${postgres_database}" \
    -v community_host="${community_host}" \
    -v agent_pubkey="${agent_pubkey}" \
    -v owner_pubkey="${owner_pubkey}" \
    -v model_revision="${model_revision}" \
    -f /dev/stdin < "${REPO_ROOT}/deploy/airhop/hermes-bootstrap.sql"

echo "Hermes deployment is ready. Start it with:"
echo "docker compose --env-file ${ENV_FILE} -f ${COMPOSE_FILE} --profile hermes up -d hermes-parent-runtime"
