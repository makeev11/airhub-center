#!/usr/bin/env bash
# One-shot, demo-only rollout. Never restores a database or changes ownership.
set -euo pipefail
umask 077

release_dir=/opt/airhop/buzz-demo/releases
build_dir=/opt/airhop/relay-build-analytics-20260907
backup_dir=/opt/airhop/backups/demo-before-analytics-20260907
env_file=/opt/airhop/buzz-demo/source/deploy/compose/.env
base_file=/opt/airhop/buzz-demo/source/deploy/compose/compose.yml
host_file=/opt/airhop/buzz-demo/buzz-demo.override.yml
hermes_file=/opt/airhop/relay-build-f9730f5/deploy/airhop/compose.existing.yml
old_release=$release_dir/f9730f5.compose.yml
new_release=$release_dir/analytics-demo-20260907.compose.yml
rollback_file=$release_dir/analytics-demo-20260907.rollback.yml
image=airhub-center-relay:analytics-20260907-879f9cda-hygge
compose=(docker compose --project-name buzz-demo --env-file "$env_file"
  -f "$base_file" -f "$host_file" -f "$hermes_file" -f "$old_release"
  --profile hermes --profile telegram)

test "$(docker inspect buzz-demo-relay-1 --format '{{.Config.Image}}')" = airhub-center-relay:f9730f5-booking-cta-20260907
test "$(docker image inspect "$image" --format '{{index .Config.Labels "ru.airhop.source-archive-sha256"}}')" = 879f9cda81fd5d78e59dc0b0b55b11c799fd6a3206b183c8b24136764fdf8b44
test "$(docker image inspect "$image" --format '{{index .Config.Labels "ru.airhop.frontend-archive-sha256"}}')" = bdcfdb3af6e3b059078244bf2124c957c0037e46e9fc2cd025a1126204485b08
test "$(docker exec buzz-demo-postgres-1 psql -X -U buzz -d buzz -Atc 'SELECT max(version) FROM _sqlx_migrations WHERE success')" = 52
test "$(docker exec buzz-demo-postgres-1 psql -X -U buzz -d buzz -Atc "SELECT count(*) FROM airhop_organizations o JOIN communities c ON c.id=o.community_id WHERE c.host='demo.airhop.ru' AND o.id='7e510ed1-15a1-4a75-8d3d-33f924fe18a0' AND o.status='active'")" = 1
test "$(df --output=avail -k /opt/airhop | tail -n 1)" -gt 2097152
test ! -e "$backup_dir"
"${compose[@]}" -f "$new_release" config --quiet
"${compose[@]}" -f "$rollback_file" config --quiet
production_before=$(docker inspect buzz-prod-relay-1 --format '{{.Image}} {{.State.StartedAt}}')
unchanged_before=$(docker inspect buzz-demo-postgres-1 buzz-demo-redis-1 buzz-demo-minio-1 buzz-demo-pairing-relay-1 buzz-demo-hermes-parent-runtime-1 buzz-demo-telegram-gateway-1 --format '{{.Name}} {{.Id}} {{.State.StartedAt}}')
config_before=$(sha256sum "$env_file" "$base_file" "$host_file" "$hermes_file" "$old_release")
install -d -m 0700 "$backup_dir"
cp -p "$env_file" "$backup_dir/demo.env"
cp "$base_file" "$backup_dir/base-compose.yml"
cp "$host_file" "$backup_dir/host-compose.yml"
cp "$hermes_file" "$backup_dir/hermes-compose.yml"
cp "$old_release" "$backup_dir/previous-release.yml"
docker inspect buzz-demo-relay-1 --format '{{.Config.Image}} {{.Image}} {{.State.StartedAt}}' > "$backup_dir/previous-image.txt"
docker exec buzz-demo-postgres-1 pg_dump -U buzz -d buzz -Fc > "$backup_dir/buzz.dump"
test -s "$backup_dir/buzz.dump"
docker exec -i buzz-demo-postgres-1 pg_restore --list < "$backup_dir/buzz.dump" > "$backup_dir/database-contents.txt"

# Restore and validate migration 0053 against a separate database first. Keep it
# for the acceptance record; it is never used by the live relay or agents.
preflight_db=buzz_analytics_preflight_20260907
test "$(docker exec buzz-demo-postgres-1 psql -X -U buzz -d postgres -Atc "SELECT count(*) FROM pg_database WHERE datname='$preflight_db'")" = 0
docker exec buzz-demo-postgres-1 createdb -U buzz "$preflight_db"
docker exec -i buzz-demo-postgres-1 pg_restore -U buzz --exit-on-error -d "$preflight_db" < "$backup_dir/buzz.dump"
docker exec -i buzz-demo-postgres-1 psql -X -U buzz -d "$preflight_db" --set ON_ERROR_STOP=1 --single-transaction < "$build_dir/migrations/0053_airhop_site_analytics.sql" > "$backup_dir/migration-preflight.txt"
test "$config_before" = "$(sha256sum "$env_file" "$base_file" "$host_file" "$hermes_file" "$old_release")"
test "$production_before" = "$(docker inspect buzz-prod-relay-1 --format '{{.Image}} {{.State.StartedAt}}')"

rollback() {
  trap - ERR
  echo "Demo postflight failed; restoring the previous demo image without removing data." >&2
  "${compose[@]}" -f "$rollback_file" up -d --no-deps --wait --wait-timeout 180 relay
  echo "Rollback complete. New analytics tables and all existing data are retained." >&2
  exit 1
}
trap rollback ERR
"${compose[@]}" -f "$new_release" up -d --no-deps --wait --wait-timeout 180 relay
test "$(docker exec buzz-demo-postgres-1 psql -X -U buzz -d buzz -Atc 'SELECT max(version) FROM _sqlx_migrations WHERE success')" = 53
curl --fail --silent --show-error --max-time 15 https://demo.airhop.ru/health > "$backup_dir/health-after.json"
curl --fail --silent --show-error --max-time 15 https://demo.airhop.ru/api/airhop/public/v1/catalog > "$backup_dir/catalog-after.json"
curl --fail --silent --show-error --max-time 15 https://demo.airhop.ru/airhop/hygge/ > "$backup_dir/site-after.html"
grep -q 'airhop-analytics.v1.js' "$backup_dir/site-after.html"
test "$production_before" = "$(docker inspect buzz-prod-relay-1 --format '{{.Image}} {{.State.StartedAt}}')"
test "$unchanged_before" = "$(docker inspect buzz-demo-postgres-1 buzz-demo-redis-1 buzz-demo-minio-1 buzz-demo-pairing-relay-1 buzz-demo-hermes-parent-runtime-1 buzz-demo-telegram-gateway-1 --format '{{.Name}} {{.Id}} {{.State.StartedAt}}')"
trap - ERR
echo "Demo analytics release is healthy. Production, storage, agents and identity configuration are unchanged."
echo "Backup and successful restore/migration preflight: $backup_dir"
