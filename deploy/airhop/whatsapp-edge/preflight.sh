#!/bin/sh

set -eu

public_host=${AIRHOP_WHATSAPP_PUBLIC_HOST:?set AIRHOP_WHATSAPP_PUBLIC_HOST}
expected_ip=${AIRHOP_EXPECTED_PUBLIC_IP:?set AIRHOP_EXPECTED_PUBLIC_IP}
origin="https://${public_host}"

if command -v dig >/dev/null 2>&1; then
  resolved=$(
    {
      dig +short A "$public_host"
      dig +short AAAA "$public_host"
    } | sed '/^$/d'
  )
elif command -v getent >/dev/null 2>&1; then
  resolved=$(getent ahosts "$public_host" | awk '{print $1}' | sort -u)
else
  printf 'Neither dig nor getent is available for the DNS fence\n' >&2
  exit 1
fi
if ! printf '%s\n' "$resolved" | grep -Fqx "$expected_ip"; then
  printf 'DNS mismatch: %s does not resolve to %s\n' "$public_host" "$expected_ip" >&2
  exit 1
fi

health_body=$(curl --fail --silent --show-error "${origin}/healthz")
if [ "$health_body" != "ok" ]; then
  printf 'Unexpected health response from %s/healthz\n' "$origin" >&2
  exit 1
fi

root_status=$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "${origin}/")
if [ "$root_status" != "404" ]; then
  printf 'Unexpected public root status: %s (expected 404)\n' "$root_status" >&2
  exit 1
fi

unknown_status=$(
  curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
    "${origin}/webhooks/whatsapp/00000000-0000-0000-0000-000000000000"
)
if [ "$unknown_status" != "404" ]; then
  printf 'Unknown webhook path returned %s (expected 404)\n' "$unknown_status" >&2
  exit 1
fi

printf 'WhatsApp edge preflight passed for %s\n' "$public_host"
