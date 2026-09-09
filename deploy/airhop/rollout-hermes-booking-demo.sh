#!/usr/bin/env bash
# User-authorized demo rollout. Never downgrades/restores the live database.
set -euo pipefail
umask 077
build_dir=$(realpath "${1:?candidate directory}")
[[ "$build_dir" =~ ^/opt/airhop/hermes-booking-[0-9a-f]{12}$ ]]
cd "$build_dir"
commit=$(jq -er .commit release.json)
release=$(jq -er .releaseId release.json)
short=${commit:0:12}
[[ "$commit" =~ ^[0-9a-f]{40}$ ]]
test "${build_dir##*-}" = "$short"
test "$(jq -er .commit build-complete.json)" = "$commit"
test "$(sha256sum source.tgz | cut -d ' ' -f 1)" = "$(jq -er .sourceArchiveSha256 source-manifest.json)"
jq -r '.files[] | "\(.sha256)  \(.path)"' source-manifest.json | sha256sum -c --quiet -
old_relay=airhub-center-relay:airhop-center-0.5.6-4322563f72a7
old_hermes=airhop-hermes-parent-runtime:f9730f5
relay=airhub-center-relay:$release
hermes=airhop-hermes-parent-runtime:$release
test "$(docker inspect buzz-demo-relay-1 --format '{{.Config.Image}}')" = "$old_relay"
test "$(docker inspect buzz-demo-relay-1 --format '{{.Image}}')" = sha256:74d0bb5bc4d983c3719f5610ef74767ec8bf13276db02d8b0cf268542355ea5b
test "$(docker inspect buzz-demo-hermes-parent-runtime-1 --format '{{.Config.Image}}')" = "$old_hermes"
test "$(docker inspect buzz-demo-hermes-parent-runtime-1 --format '{{.Image}}')" = sha256:460135068b244ba42132579e505d2890e6fe644db156221b46a38463194bf84c
for image in "$relay" "$hermes"; do
  test "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$commit"
done
test "$(df --output=avail -k /opt/airhop | tail -n 1)" -gt 2097152
sql() { docker exec buzz-demo-postgres-1 psql -X -qAt -v ON_ERROR_STOP=1 -U buzz -d buzz -c "$1"; }
test "$(sql 'SELECT max(version) FROM _sqlx_migrations WHERE success')" = 54
test "$(sql "SELECT count(*) FROM airhop_organizations o JOIN communities c ON c.id=o.community_id WHERE c.host='demo.airhop.ru' AND o.id='7e510ed1-15a1-4a75-8d3d-33f924fe18a0' AND o.status='active'")" = 1
test "$(sql "SELECT count(*) FROM airhop_hermes_turn_receipts WHERE status='leased' AND lease_expires_at>now()")" = 0
controls_before=$(sql "SELECT enabled,paused,manage_bookings,auto_confirm_online_bookings,version FROM airhop_agent_deployments ORDER BY id")
env_file=/opt/airhop/buzz-demo/source/deploy/compose/.env
files=(
  /opt/airhop/buzz-demo/source/deploy/compose/compose.yml
  /opt/airhop/buzz-demo/buzz-demo.override.yml
  /opt/airhop/relay-build-f9730f5/deploy/airhop/compose.existing.yml
  /opt/airhop/buzz-demo/releases/f9730f5.compose.yml
  /opt/airhop/buzz-demo/releases/analytics-demo-20260907.compose.yml
  /opt/airhop/relay-build-0.5.6-4322563f72a7/demo-0.5.6.compose.yml
)
compose=(docker compose --project-name buzz-demo --env-file "$env_file")
for file in "${files[@]}"; do compose+=(-f "$file"); done
compose+=(--profile hermes --profile telegram)
test ! -e rollout.compose.json
jq -n --arg relay "$relay" --arg hermes "$hermes" --arg release "$release" --arg commit "$commit" \
  '{services:{relay:{image:$relay,environment:{BUZZ_AUTO_MIGRATE:"true"},labels:{"ru.airhop.release":$release,"ru.airhop.source-commit":$commit}},"hermes-parent-runtime":{image:$hermes,labels:{"ru.airhop.release":$release,"ru.airhop.source-commit":$commit}}}}' > rollout.compose.json
jq -n --arg relay "$old_relay" --arg hermes "$old_hermes" \
  '{services:{relay:{image:$relay,environment:{BUZZ_AUTO_MIGRATE:"false"}},"hermes-parent-runtime":{image:$hermes}}}' > rollback.compose.json
"${compose[@]}" -f "$build_dir/rollout.compose.json" config --quiet
"${compose[@]}" -f "$build_dir/rollback.compose.json" config --quiet
config_before=$(sha256sum "$env_file" "${files[@]}")
mapfile -t neighbors < <(docker ps --format '{{.Names}}' | sort | sed -e '/^buzz-demo-relay-1$/d' -e '/^buzz-demo-hermes-parent-runtime-1$/d')
neighbors_before=$(docker inspect "${neighbors[@]}" --format '{{.Name}} {{.Id}} {{.State.StartedAt}}')
backup_dir=/opt/airhop/backups/demo-before-hermes-booking-$short
test ! -e "$backup_dir"
install -d -m 0700 "$backup_dir"
cp -p "$env_file" "$backup_dir/demo.env"
for index in "${!files[@]}"; do cp "${files[$index]}" "$backup_dir/compose-$index.yml"; done
docker inspect buzz-demo-relay-1 buzz-demo-hermes-parent-runtime-1 --format '{{.Name}} {{.Config.Image}} {{.Image}} {{.State.StartedAt}}' > "$backup_dir/previous-images.txt"
printf '%s\n' "$neighbors_before" > "$backup_dir/neighbors-before.txt"
printf '%s\n' "$controls_before" > "$backup_dir/hermes-controls-before.txt"
rollback() {
  trap - ERR
  echo 'Postflight failed; restoring old demo images, retaining all database data.' >&2
  "${compose[@]}" -f "$build_dir/rollback.compose.json" up -d --no-deps --wait --wait-timeout 180 relay hermes-parent-runtime
  echo "Rollback completed. Backup: $backup_dir" >&2
  exit 1
}
trap rollback ERR
"${compose[@]}" stop -t 45 hermes-parent-runtime
test "$(sql "SELECT count(*) FROM airhop_hermes_turn_receipts WHERE status='leased' AND lease_expires_at>now()")" = 0
docker run --rm --network none --read-only --volumes-from buzz-demo-hermes-parent-runtime-1:ro --entrypoint tar "$old_hermes" -czf - -C /var/lib/airhop-hermes-runtime . > "$backup_dir/hermes-runtime.tgz"
tar -tzf "$backup_dir/hermes-runtime.tgz" > "$backup_dir/hermes-runtime-files.txt"
docker exec buzz-demo-postgres-1 pg_dump -U buzz -d buzz -Fc > "$backup_dir/buzz.dump"
test -s "$backup_dir/buzz.dump"
docker exec -i buzz-demo-postgres-1 pg_restore --list < "$backup_dir/buzz.dump" > "$backup_dir/database-contents.txt"
preflight_db=buzz_booking_preflight_$short
test "$(docker exec buzz-demo-postgres-1 psql -X -U buzz -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname='$preflight_db'")" = 0
docker exec buzz-demo-postgres-1 createdb -U buzz "$preflight_db"
docker exec buzz-demo-postgres-1 psql -X -v ON_ERROR_STOP=1 -U buzz -d postgres -c "REVOKE CONNECT ON DATABASE $preflight_db FROM PUBLIC" > "$backup_dir/preflight-access.txt"
docker exec -i buzz-demo-postgres-1 pg_restore -U buzz --exit-on-error -d "$preflight_db" < "$backup_dir/buzz.dump"
docker exec -i buzz-demo-postgres-1 psql -X -v ON_ERROR_STOP=1 -U buzz -d "$preflight_db" --single-transaction < migrations/0055_airhop_conversation_booking.sql > "$backup_dir/migration-preflight.txt"
test "$(docker exec buzz-demo-postgres-1 psql -X -U buzz -d "$preflight_db" -Atc "SELECT count(*) FROM airhop_conversation_booking_drafts")" = 0
test "$config_before" = "$(sha256sum "$env_file" "${files[@]}")"
"${compose[@]}" -f "$build_dir/rollout.compose.json" up -d --no-deps --wait --wait-timeout 180 relay
test "$(sql 'SELECT max(version) FROM _sqlx_migrations WHERE success')" = 55
curl --fail --silent --show-error --max-time 20 https://demo.airhop.ru/health > "$backup_dir/health-after.json"
"${compose[@]}" -f "$build_dir/rollout.compose.json" up -d --no-deps --wait --wait-timeout 180 hermes-parent-runtime
timeout 30 python3 deploy/airhop/check-booking-mcp.py --live > "$backup_dir/mcp-live.json"
curl --fail --silent --show-error --max-time 20 https://demo.airhop.ru/api/airhop/public/v1/catalog > "$backup_dir/catalog-after.json"
curl --fail --silent --show-error --max-time 20 https://demo.airhop.ru/booking > "$backup_dir/booking-after.html"
docker exec -i buzz-demo-relay-1 sh -c 'cd /srv/airhop/public-web && sha256sum -c -' < public-before.sha256 > "$backup_dir/public-after.txt"
test "$controls_before" = "$(sql "SELECT enabled,paused,manage_bookings,auto_confirm_online_bookings,version FROM airhop_agent_deployments ORDER BY id")"
test "$config_before" = "$(sha256sum "$env_file" "${files[@]}")"
test "$neighbors_before" = "$(docker inspect "${neighbors[@]}" --format '{{.Name}} {{.Id}} {{.State.StartedAt}}')"
AIRHOP_ENV_FILE="$env_file" AIRHOP_COMPOSE_PROJECT_NAME=buzz-demo AIRHOP_DEMO_HOST=demo.airhop.ru \
  AIRHOP_COMPOSE_FILES="$(IFS=:; echo "${files[*]}"):$build_dir/rollout.compose.json" \
  bash scripts/check-airhop-hermes-pilot.sh > "$backup_dir/pilot-after.txt"
trap - ERR
docker inspect buzz-demo-relay-1 buzz-demo-hermes-parent-runtime-1 --format '{{.Name}} {{.Config.Image}} {{.Image}} {{.State.StartedAt}}' > "$backup_dir/deployed-images.txt"
jq -n --arg commit "$commit" --arg backup "$backup_dir" --arg release "$release" \
  '{status:"deployed",commit:$commit,release:$release,backup:$backup,migration:55,liveParentActions:0}' > rollout-result.json
echo "Demo relay and Hermes updated. Existing controls, public files and all neighboring services preserved. Backup: $backup_dir"
