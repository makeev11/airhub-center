#!/bin/sh
set -eu

require_env() {
  variable_name="$1"
  eval "variable_value=\${$variable_name:-}"
  if [ -z "$variable_value" ]; then
    echo "airhop-hermes-runtime: required environment variable $variable_name is missing" >&2
    exit 64
  fi
}

require_env BUZZ_RELAY_URL
require_env BUZZ_PRIVATE_KEY
require_env DEEPSEEK_API_KEY

umask 077
mkdir -p "$HERMES_HOME" "$AIRHOP_HERMES_RUNTIME_ROOT/runtime" "$AIRHOP_HERMES_RUNTIME_ROOT/workspace"
cp /opt/airhop-hermes/config.yaml "$HERMES_HOME/config.yaml"
: > "$BUZZ_AIRHOP_CONTEXT_GRANT_FILE"
chmod 600 "$HERMES_HOME/config.yaml" "$BUZZ_AIRHOP_CONTEXT_GRANT_FILE"

cd "$AIRHOP_HERMES_RUNTIME_ROOT/workspace"
exec buzz-acp
