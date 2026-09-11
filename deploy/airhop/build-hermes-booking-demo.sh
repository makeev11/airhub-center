#!/usr/bin/env bash
# Build only. Does not stop services, prune cache or change deployment settings.
set -euo pipefail
umask 077
build_dir=$(realpath "${1:?candidate directory}")
[[ "$build_dir" =~ ^/opt/airhop/hermes-booking-[0-9a-f]{12}$ ]]
cd "$build_dir"
commit=$(jq -er .commit release.json)
release=$(jq -er .releaseId release.json)
archive_sha=$(jq -er .sourceArchiveSha256 source-manifest.json)
[[ "$commit" =~ ^[0-9a-f]{40}$ ]]
test "${build_dir##*-}" = "${commit:0:12}"
test "$(sha256sum source.tgz | cut -d ' ' -f 1)" = "$archive_sha"
jq -r '.files[] | "\(.sha256)  \(.path)"' source-manifest.json | sha256sum -c --quiet -

build_base=airhop-booking-binaries:airhop-center-0.5.6-da09388809b1
build_id=sha256:fa566640a8ea44349544ed9e07ed85e4376561ca8391e89721690d269901cb0e
relay_base=airhub-center-relay:airhop-center-0.5.6-da09388809b1
relay_id=sha256:99452628d3a8062540f8d41ce91444b587fa7f0139dcf74f0751b5cd66bc7597
hermes_base=airhop-hermes-parent-runtime:airhop-center-0.5.6-da09388809b1
hermes_id=sha256:60c757895e431fd264a27321231fcd9789bee38d354c302e09b4d44cddcb8693
verify_bases() {
  test "$(docker image inspect "$build_base" --format '{{.Id}}')" = "$build_id"
  test "$(docker image inspect "$relay_base" --format '{{.Id}}')" = "$relay_id"
  test "$(docker image inspect "$hermes_base" --format '{{.Id}}')" = "$hermes_id"
}
verify_bases
test "$(df --output=avail -k /opt/airhop | tail -n 1)" -gt 4194304
test ! -e build-complete.json
for image in "airhop-booking-binaries:$release" "airhub-center-relay:$release" "airhop-hermes-parent-runtime:$release"; do
  if docker image inspect "$image" >/dev/null 2>&1; then
    echo "Refusing to overwrite existing image $image" >&2
    exit 1
  fi
done

args=(--progress=plain -f deploy/airhop/Dockerfile.hermes-booking
  --build-arg "BUILD_BASE=$build_base" --build-arg "RELAY_BASE=$relay_base"
  --build-arg "HERMES_BASE=$hermes_base" --build-arg "RELAY_BASE_ID=$relay_id"
  --build-arg "HERMES_BASE_ID=$hermes_id" --build-arg "SOURCE_COMMIT=$commit"
  --build-arg "SOURCE_ARCHIVE_SHA256=$archive_sha" --build-arg "RELEASE_ID=$release")
run_build() {
  local target=$1 image=$2
  shift 2
  test ! -e "$target.log"
  docker build "${args[@]}" "$@" --target "$target" --tag "$image" . > "$target.log" 2>&1 &
  local build_pid=$!
  while kill -0 "$build_pid" 2>/dev/null; do
    if test "$(df --output=avail -k /opt/airhop | tail -n 1)" -lt 2097152; then
      kill -TERM "$build_pid"
      wait "$build_pid" || true
      echo 'Build stopped to preserve 2 GiB for running services; no cleanup performed.' >&2
      return 1
    fi
    sleep 10
  done
  wait "$build_pid"
}
run_build booking-binaries "airhop-booking-binaries:$release"
run_build booking-relay "airhub-center-relay:$release" --build-context "booking-binaries=docker-image://airhop-booking-binaries:$release"
run_build booking-hermes "airhop-hermes-parent-runtime:$release" --build-context "booking-binaries=docker-image://airhop-booking-binaries:$release"
verify_bases
for image in "airhub-center-relay:$release" "airhop-hermes-parent-runtime:$release"; do
  test "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$commit"
done
docker run --rm --network none --read-only --entrypoint /usr/local/bin/sprig "airhop-hermes-parent-runtime:$release" --version
timeout 30 python3 deploy/airhop/check-booking-mcp.py "airhop-hermes-parent-runtime:$release" > mcp-image-preflight.json
# The previous public bundle is an intentional, unchanged dependency.
docker exec buzz-demo-relay-1 sh -c 'cd /srv/airhop/public-web && find . -type f -exec sha256sum {} \;' > public-before.sha256
docker run --rm --network none --read-only -i --entrypoint sh "airhub-center-relay:$release" -c 'cd /srv/airhop/public-web && sha256sum -c -' < public-before.sha256 > public-image-preflight.txt
jq -n --arg commit "$commit" --arg release "$release" --arg archive "$archive_sha" '{commit:$commit,release:$release,sourceArchiveSha256:$archive}' > build-complete.json
echo "Images ready; no live service changed. $release"
