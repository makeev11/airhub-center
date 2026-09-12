#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${AIRHOP_ENV_FILE:-${REPO_ROOT}/deploy/airhop/.env}"
COMPOSE_FILE="${AIRHOP_COMPOSE_FILE:-${REPO_ROOT}/deploy/airhop/compose.yml}"
DEMO_HOST="${AIRHOP_DEMO_HOST:-}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "AirHop environment file not found: ${ENV_FILE}" >&2
  exit 1
fi

if [[ -z "${DEMO_HOST}" ]]; then
  DEMO_HOST="$(sed -n 's/^RELAY_URL=//p' "${ENV_FILE}" | tail -n 1)"
  DEMO_HOST="${DEMO_HOST#ws://}"
  DEMO_HOST="${DEMO_HOST#wss://}"
  DEMO_HOST="${DEMO_HOST%%/*}"
fi

if [[ -z "${DEMO_HOST}" || "${DEMO_HOST}" == *"CHANGE_ME"* ]]; then
  echo "Set AIRHOP_DEMO_HOST or a concrete RELAY_URL in ${ENV_FILE}." >&2
  exit 1
fi

POSTGRES_USER_VALUE="$(sed -n 's/^POSTGRES_USER=//p' "${ENV_FILE}" | tail -n 1)"
COMPOSE_PROJECT_VALUE="${AIRHOP_COMPOSE_PROJECT_NAME:-$(sed -n 's/^AIRHOP_COMPOSE_PROJECT_NAME=//p' "${ENV_FILE}" | tail -n 1)}"
if [[ -z "${COMPOSE_PROJECT_VALUE}" || "${COMPOSE_PROJECT_VALUE}" == "buzz-prod" || "${DEMO_HOST}" == "hq.airhop.ru" || ( "${DEMO_HOST}" == "demo.airhop.ru" && "${COMPOSE_PROJECT_VALUE}" != "buzz-demo" ) ]]; then
  echo "Set an explicit Center Compose project matching the host. See docs/AIRHOP_DEPLOYMENT_MAP.md." >&2
  exit 1
fi
POSTGRES_DB_VALUE="$(sed -n 's/^POSTGRES_DB=//p' "${ENV_FILE}" | tail -n 1)"
POSTGRES_USER_VALUE="${POSTGRES_USER_VALUE:-airhop}"
POSTGRES_DB_VALUE="${POSTGRES_DB_VALUE:-airhop}"

echo "Seeding the real Booking Core tables for ${DEMO_HOST}..."
AIRHOP_ENV_FILE="${ENV_FILE}" docker compose \
  --project-name "${COMPOSE_PROJECT_VALUE}" \
  --env-file "${ENV_FILE}" \
  -f "${COMPOSE_FILE}" \
  exec -T postgres \
  psql \
    -U "${POSTGRES_USER_VALUE}" \
    -d "${POSTGRES_DB_VALUE}" \
    -v community_host="${DEMO_HOST}" \
    -f /dev/stdin < "${REPO_ROOT}/deploy/airhop/demo-seed.sql"

echo "AirHop demo data is ready at http://${DEMO_HOST}/booking"
