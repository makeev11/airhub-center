#!/usr/bin/env bash
set -euo pipefail

release_id=hygge-br-center-a52e478
lock=/opt/airhop/buzz-demo/deploy.lock
target_caddy=/opt/airhop/site/source/deploy/beget/site/Caddyfile
backup=/opt/airhop/backups/$release_id
record=/opt/airhop/buzz-demo/releases/$release_id/release.record
expected_daemon=dbfb14a9-8404-4f21-ad3e-3481b173ea9a
expected_relay=1383bdd769d909c3f540f6545f4cfe1b78eb8ec988600c9278dcbd114a0cc15e
expected_relay_image=sha256:975aa77c3844fbf8b5ccdec6c9f0f0c306b39b2edfec9dcaef14455327511f5d
expected_caddy=3cefbff3f55b4e592d531cc53541c401011e717b1d57b2cfe0e4a3c1581f56ab
candidate_caddy_hash=edf2a0dcd773866b25f017029b48276bf005f9fcd98660f6f5173d46d1f47f25

test "$(hostname)" = airhop-prod
test "$(docker info --format '{{.ID}}')" = "$expected_daemon"

exec 9>"$lock"
flock -n 9 || { echo "Center demo deployment lock is busy" >&2; exit 73; }

test "$(docker inspect --format '{{.Id}}' buzz-demo-relay-1)" = "$expected_relay"
test "$(docker inspect --format '{{.Image}}' buzz-demo-relay-1)" = "$expected_relay_image"
test "$(docker inspect --format '{{.Id}}' airhop-site-caddy-1)" = "$expected_caddy"
test "$(docker inspect --format '{{.State.Health.Status}}' buzz-demo-relay-1)" = healthy
test "$(docker inspect --format '{{.State.Health.Status}}' airhop-site-caddy-1)" = healthy
test "$(sha256sum "$target_caddy" | cut -d' ' -f1)" = "$candidate_caddy_hash"
test -s "$backup/buzz.dump"
test -s "$backup/Caddyfile"
test -s "$record"

organization_count=$(docker exec buzz-demo-postgres-1 psql -X -U buzz -d buzz -Atc "SELECT count(*) FROM communities c JOIN airhop_organizations o ON o.community_id=c.id WHERE c.host='center.airhop.com.br' AND o.locale='pt-BR' AND o.time_zone='America/Sao_Paulo' AND o.currency='BRL'")
test "$organization_count" = 1

docker exec -i airhop-site-caddy-1 caddy validate --config - --adapter caddyfile <"$target_caddy"
docker exec -i airhop-site-caddy-1 caddy reload --config - --adapter caddyfile <"$target_caddy"
docker exec airhop-site-caddy-1 wget -qO- http://127.0.0.1:2019/config/ | grep -Fq 'center.airhop.com.br'

printf 'runtime_config_loaded_at=%s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" >>"$record"
echo "Loaded public Caddy runtime config for $release_id"
