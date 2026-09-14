#!/usr/bin/env bash
set -euo pipefail

release_dir=${1:?Usage: apply-hygge-br-demo.sh RELEASE_DIR}
release_id=hygge-br-center-a52e478
lock=/opt/airhop/buzz-demo/deploy.lock
target_caddy=/opt/airhop/site/source/deploy/beget/site/Caddyfile
backup=/opt/airhop/backups/$release_id
record=/opt/airhop/buzz-demo/releases/$release_id/release.record
expected_daemon=dbfb14a9-8404-4f21-ad3e-3481b173ea9a
expected_relay=1383bdd769d909c3f540f6545f4cfe1b78eb8ec988600c9278dcbd114a0cc15e
expected_relay_image=sha256:975aa77c3844fbf8b5ccdec6c9f0f0c306b39b2edfec9dcaef14455327511f5d
expected_caddy=3cefbff3f55b4e592d531cc53541c401011e717b1d57b2cfe0e4a3c1581f56ab
expected_caddy_hash=de0c5f43292db20a63b01683cec7fa1590907258dfb91568d51e0a80d7119795
candidate_caddy_hash=edf2a0dcd773866b25f017029b48276bf005f9fcd98660f6f5173d46d1f47f25
seed_hash=bb0b2e1dfd8a064ec488122cae0c762b9d9da25b711ee9bfa067e378d8a92cd8

test "$(hostname)" = airhop-prod
test "$(docker info --format '{{.ID}}')" = "$expected_daemon"
test -f "$release_dir/hygge-br-demo-seed.sql"
test -f "$release_dir/Caddyfile.center-br.candidate"
test "$(sha256sum "$release_dir/hygge-br-demo-seed.sql" | cut -d' ' -f1)" = "$seed_hash"
test "$(sha256sum "$release_dir/Caddyfile.center-br.candidate" | cut -d' ' -f1)" = "$candidate_caddy_hash"

exec 9>"$lock"
flock -n 9 || { echo "Center demo deployment lock is busy" >&2; exit 73; }

test "$(docker inspect --format '{{.Id}}' buzz-demo-relay-1)" = "$expected_relay"
test "$(docker inspect --format '{{.Image}}' buzz-demo-relay-1)" = "$expected_relay_image"
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' buzz-demo-relay-1)" = buzz-demo
test "$(docker inspect --format '{{.Id}}' airhop-site-caddy-1)" = "$expected_caddy"
test "$(docker inspect --format '{{index .Config.Labels "com.docker.compose.project"}}' airhop-site-caddy-1)" = airhop-site
test "$(sha256sum "$target_caddy" | cut -d' ' -f1)" = "$expected_caddy_hash"
test "$(docker exec buzz-demo-postgres-1 psql -X -U buzz -d buzz -Atc \"SELECT count(*) FROM communities WHERE lower(host)='center.airhop.com.br'\")" = 0
test ! -e "$backup"

install -d -m 0700 "$backup"
install -m 0600 "$target_caddy" "$backup/Caddyfile"
docker exec buzz-demo-postgres-1 pg_dump -U buzz -d buzz -Fc >"$backup/buzz.dump"
chmod 0600 "$backup/buzz.dump"
sha256sum "$backup/Caddyfile" "$backup/buzz.dump" >"$backup/SHA256SUMS"
chmod 0600 "$backup/SHA256SUMS"

restore_caddy() {
  install -m 0644 "$backup/Caddyfile" "$target_caddy"
  docker exec airhop-site-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile || true
}
trap restore_caddy ERR

install -m 0644 "$release_dir/Caddyfile.center-br.candidate" "$target_caddy"
docker exec airhop-site-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile

docker cp "$release_dir/hygge-br-demo-seed.sql" buzz-demo-postgres-1:/tmp/hygge-br-demo-seed.sql
docker exec buzz-demo-postgres-1 psql -X -U buzz -d buzz -v ON_ERROR_STOP=1 -v dry_run=false -f /tmp/hygge-br-demo-seed.sql

test "$(docker inspect --format '{{.Id}}' buzz-demo-relay-1)" = "$expected_relay"
test "$(docker inspect --format '{{.Image}}' buzz-demo-relay-1)" = "$expected_relay_image"
test "$(docker inspect --format '{{.Id}}' airhop-site-caddy-1)" = "$expected_caddy"
test "$(docker inspect --format '{{.State.Health.Status}}' buzz-demo-relay-1)" = healthy
test "$(docker inspect --format '{{.State.Health.Status}}' airhop-site-caddy-1)" = healthy
test "$(sha256sum "$target_caddy" | cut -d' ' -f1)" = "$candidate_caddy_hash"
test "$(docker exec buzz-demo-postgres-1 psql -X -U buzz -d buzz -Atc \"SELECT count(*) FROM communities c JOIN airhop_organizations o ON o.community_id=c.id WHERE c.host='center.airhop.com.br' AND o.locale='pt-BR' AND o.time_zone='America/Sao_Paulo' AND o.currency='BRL'\")" = 1

trap - ERR
install -d -m 0755 "$(dirname "$record")"
{
  printf 'release_id=%s\n' "$release_id"
  printf 'center_source_commit=%s\n' a52e478
  printf 'relay_container_id=%s\n' "$expected_relay"
  printf 'relay_image_id=%s\n' "$expected_relay_image"
  printf 'caddy_container_id=%s\n' "$expected_caddy"
  printf 'caddy_sha256=%s\n' "$candidate_caddy_hash"
  printf 'seed_sha256=%s\n' "$seed_hash"
  printf 'backup=%s\n' "$backup"
  printf 'applied_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
} >"$record"
chmod 0600 "$record"

echo "Activated $release_id"
