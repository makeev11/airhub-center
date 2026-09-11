#!/usr/bin/env bash

set -euo pipefail

fail() {
  printf 'state-transfer self-test failed: %s\n' "$*" >&2
  exit 1
}

if [[ $# -ne 1 ]]; then
  printf 'Usage: ./test-state-transfer.sh HELPER_IMAGE\n' >&2
  exit 2
fi

helper_image=$1
script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
test_id="airhop-edge-transfer-test-$$"
source_volume="${test_id}-source"
target_volume="${test_id}-target"
test_dir=$(mktemp -d "/tmp/${test_id}.XXXXXX")
archive="${test_dir}/state.tar.gz"

cleanup() {
  docker volume rm "$source_volume" "$target_volume" >/dev/null 2>&1 || true
  rm -rf "$test_dir"
}
trap cleanup EXIT

docker image inspect "$helper_image" >/dev/null
docker volume create "$source_volume" >/dev/null
docker volume create "$target_volume" >/dev/null

docker run --rm \
  --user 0:0 \
  --entrypoint /bin/sh \
  --volume "${source_volume}:/target" \
  "$helper_image" \
  -ec 'mkdir -p /target/connections/sample && printf "transfer-proof\n" > /target/connections/sample/state.sqlite3 && chown -R 10001:10001 /target'

"${script_dir}/state-transfer.sh" backup \
  "$source_volume" \
  "$archive" \
  "$helper_image"
"${script_dir}/state-transfer.sh" restore \
  "$target_volume" \
  "$archive" \
  "$helper_image"

restored_content=$(
  docker run --rm \
    --user 0:0 \
    --entrypoint cat \
    --volume "${target_volume}:/target:ro" \
    "$helper_image" \
    /target/connections/sample/state.sqlite3
)
[[ $restored_content == "transfer-proof" ]] \
  || fail "restored file content differs"

restored_owner=$(
  docker run --rm \
    --user 0:0 \
    --entrypoint stat \
    --volume "${target_volume}:/target:ro" \
    "$helper_image" \
    -c '%u:%g' /target/connections/sample/state.sqlite3
)
[[ $restored_owner == "10001:10001" ]] \
  || fail "restored ownership is ${restored_owner}"

if "${script_dir}/state-transfer.sh" restore \
  "$target_volume" \
  "$archive" \
  "$helper_image"; then
  fail "restore unexpectedly accepted a non-empty target volume"
fi

printf 'State-transfer self-test passed with %s\n' "$helper_image"
