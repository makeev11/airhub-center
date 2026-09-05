#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 3 || $# -gt 4 ]]; then
  echo "Usage: $0 <public-host> <owner-pubkey-hex> <relay-image> [output-env]" >&2
  exit 64
fi

public_host="$1"
owner_pubkey="$(printf '%s' "$2" | tr '[:upper:]' '[:lower:]')"
relay_image="$3"
output_env="${4:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/.env}"

if [[ ! "${public_host}" =~ ^[a-zA-Z0-9.-]+$ ]]; then
  echo "Public host contains unsupported characters." >&2
  exit 64
fi
if [[ ! "${owner_pubkey}" =~ ^[0-9a-f]{64}$ ]]; then
  echo "Owner pubkey must be 64 lowercase hex characters." >&2
  exit 64
fi
if [[ -e "${output_env}" ]]; then
  echo "Refusing to overwrite existing environment file: ${output_env}" >&2
  exit 73
fi

for command_name in openssl awk mktemp install tr; do
  if ! command -v "${command_name}" >/dev/null 2>&1; then
    echo "Required command is missing: ${command_name}" >&2
    exit 69
  fi
done

temporary_files=("")
cleanup() {
  local path
  for path in "${temporary_files[@]}"; do
    [[ -z "${path}" ]] && continue
    rm -f -- "${path}"
  done
}
trap cleanup EXIT

random_hex() {
  openssl rand -hex "${1:-32}"
}

nostr_keypair() {
  local key_file private_hex public_hex
  key_file="$(mktemp)"
  temporary_files+=("${key_file}")
  openssl ecparam -name secp256k1 -genkey -noout -out "${key_file}" 2>/dev/null
  private_hex="$(openssl ec -in "${key_file}" -text -noout 2>/dev/null | awk '
    /priv:/ { capture = 1; next }
    /pub:/ { capture = 0 }
    capture { gsub(/[: ]/, ""); printf "%s", $0 }
    END { print "" }
  ')"
  public_hex="$(openssl ec -in "${key_file}" -text -noout 2>/dev/null | awk '
    /pub:/ { capture = 1; next }
    /ASN1 OID:/ { capture = 0 }
    capture { gsub(/[: ]/, ""); printf "%s", $0 }
    END { print "" }
  ')"
  if [[ ${#private_hex} -ne 64 || ${#public_hex} -ne 130 || "${public_hex:0:2}" != "04" ]]; then
    echo "Failed to generate a canonical secp256k1 keypair." >&2
    exit 70
  fi
  printf '%s %s\n' "${private_hex}" "${public_hex:2:64}"
}

read -r hermes_secret hermes_pubkey < <(nostr_keypair)
read -r connector_secret connector_pubkey < <(nostr_keypair)

install -m 0600 /dev/null "${output_env}"
{
  printf 'AIRHOP_IMAGE=%s\n' "${relay_image}"
  printf 'AIRHOP_HTTP_PORT=3300\n'
  printf 'AIRHOP_COMPOSE_PROJECT_NAME=airhop-center-pilot\n'
  printf 'AIRHOP_DOCKER_NETWORK=airhop-center-pilot-net\n'
  printf 'AIRHOP_TRAEFIK_ENABLED=true\n'
  printf 'AIRHOP_PUBLIC_HOST=%s\n' "${public_host}"
  printf 'RELAY_URL=wss://%s\n' "${public_host}"
  printf 'BUZZ_CORS_ORIGINS=https://%s\n' "${public_host}"
  printf 'BUZZ_MEDIA_BASE_URL=https://%s/media\n' "${public_host}"
  printf 'BUZZ_MEDIA_SERVER_DOMAIN=%s\n' "${public_host}"
  printf 'BUZZ_REQUIRE_AUTH_TOKEN=true\n'
  printf 'BUZZ_REQUIRE_RELAY_MEMBERSHIP=true\n'
  printf 'BUZZ_ALLOW_NIP_OA_AUTH=true\n'
  printf 'BUZZ_RECONCILE_CHANNELS=true\n'
  printf 'RUST_LOG=buzz_relay=info,buzz_db=info,buzz_auth=info\n'
  printf 'BUZZ_RELAY_PRIVATE_KEY=%s\n' "$(random_hex)"
  printf 'RELAY_OWNER_PUBKEY=%s\n' "${owner_pubkey}"
  printf 'BUZZ_GIT_HOOK_HMAC_SECRET=%s\n' "$(random_hex)"
  printf 'POSTGRES_DB=airhop\n'
  printf 'POSTGRES_USER=airhop\n'
  printf 'POSTGRES_PASSWORD=%s\n' "$(random_hex)"
  printf 'REDIS_PASSWORD=%s\n' "$(random_hex)"
  printf 'BUZZ_S3_ACCESS_KEY=%s\n' "$(random_hex 16)"
  printf 'BUZZ_S3_SECRET_KEY=%s\n' "$(random_hex)"
  printf 'BUZZ_S3_BUCKET=airhop-media\n'
  printf 'BUZZ_AIRHOP_PUBLIC_BOOKING_INDEX_KEY=%s\n' "$(random_hex)"
  printf 'BUZZ_AIRHOP_PUBLIC_BOOKING_MANAGEMENT_KEYS=1:%s\n' "$(random_hex)"
  printf 'BUZZ_AIRHOP_PUBLIC_BOOKING_CURRENT_KEY_VERSION=1\n'
  printf 'BUZZ_AIRHOP_PUBLIC_BOOKING_READ_REQUESTS_PER_MINUTE=120\n'
  printf 'BUZZ_AIRHOP_PUBLIC_BOOKING_IP_REQUESTS_PER_MINUTE=10\n'
  printf 'BUZZ_AIRHOP_PUBLIC_BOOKING_PHONE_REQUESTS_PER_HOUR=5\n'
  printf 'BUZZ_AIRHOP_CHANNEL_CREDENTIAL_INDEX_KEY=%s\n' "$(random_hex)"
  printf 'BUZZ_AIRHOP_CHANNEL_CREDENTIAL_KEYS=1:%s\n' "$(random_hex)"
  printf 'BUZZ_AIRHOP_CHANNEL_CURRENT_KEY_VERSION=1\n'
  printf 'AIRHOP_GATEWAY_RELAY_URL=https://%s\n' "${public_host}"
  printf 'AIRHOP_TELEGRAM_CONNECTOR_SECRET_KEY=%s\n' "${connector_secret}"
  printf 'AIRHOP_TELEGRAM_CONNECTOR_PUBKEY=%s\n' "${connector_pubkey}"
  printf 'AIRHOP_HERMES_RELAY_URL=wss://%s\n' "${public_host}"
  printf 'AIRHOP_HERMES_AGENT_SECRET_KEY=%s\n' "${hermes_secret}"
  printf 'AIRHOP_HERMES_AGENT_PUBKEY=%s\n' "${hermes_pubkey}"
  printf 'DEEPSEEK_API_KEY=%s\n' "${DEEPSEEK_API_KEY:-CHANGE_ME}"
  printf 'AIRHOP_HERMES_MODEL=%s\n' "${AIRHOP_HERMES_MODEL:-deepseek-v4-flash}"
  printf 'AIRHOP_HERMES_MAX_ITERATIONS=8\n'
  printf 'AIRHOP_HERMES_IDLE_TIMEOUT_SECONDS=180\n'
  printf 'AIRHOP_HERMES_MAX_TURN_SECONDS=300\n'
} >"${output_env}"
chmod 0600 "${output_env}"

echo "Pilot environment created at ${output_env}."
echo "Secrets were generated locally and were not printed."
if [[ "${DEEPSEEK_API_KEY:-CHANGE_ME}" == "CHANGE_ME" ]]; then
  echo "Set DEEPSEEK_API_KEY before starting the hermes profile."
fi
