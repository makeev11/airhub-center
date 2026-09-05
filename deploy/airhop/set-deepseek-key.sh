#!/usr/bin/env bash
set -euo pipefail

ENV_FILE="${1:-/opt/airhop-center-pilot/shared/.env}"

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "AirHop environment file not found: ${ENV_FILE}" >&2
  exit 1
fi

if [[ ! -t 0 ]]; then
  echo "Run this command from an interactive terminal so the key is not recorded in shell history." >&2
  exit 1
fi

read -r -s -p "DeepSeek API key: " DEEPSEEK_KEY_INPUT
printf '\n'

if [[ -z "${DEEPSEEK_KEY_INPUT}" || "${DEEPSEEK_KEY_INPUT}" == *[[:space:]]* ]]; then
  echo "The DeepSeek key must be non-empty and contain no whitespace." >&2
  exit 1
fi

umask 077
TEMP_ENV_FILE="$(mktemp "${ENV_FILE}.tmp.XXXXXX")"
trap 'rm -f "${TEMP_ENV_FILE}"' EXIT

KEY_REPLACED=false
while IFS= read -r ENV_LINE || [[ -n "${ENV_LINE}" ]]; do
  if [[ "${ENV_LINE}" == DEEPSEEK_API_KEY=* ]]; then
    printf 'DEEPSEEK_API_KEY=%s\n' "${DEEPSEEK_KEY_INPUT}" >> "${TEMP_ENV_FILE}"
    KEY_REPLACED=true
  else
    printf '%s\n' "${ENV_LINE}" >> "${TEMP_ENV_FILE}"
  fi
done < "${ENV_FILE}"

if [[ "${KEY_REPLACED}" != true ]]; then
  printf 'DEEPSEEK_API_KEY=%s\n' "${DEEPSEEK_KEY_INPUT}" >> "${TEMP_ENV_FILE}"
fi

chmod 0600 "${TEMP_ENV_FILE}"
mv "${TEMP_ENV_FILE}" "${ENV_FILE}"
trap - EXIT
unset DEEPSEEK_KEY_INPUT

echo "DeepSeek key configured in ${ENV_FILE}."
