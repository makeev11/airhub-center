#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  ./state-transfer.sh backup VOLUME ARCHIVE.tar.gz HELPER_IMAGE
  ./state-transfer.sh restore VOLUME ARCHIVE.tar.gz HELPER_IMAGE

The helper image must be the accepted Channel Gateway image. Backup refuses to
run while a container is using the source volume. Restore requires an existing,
empty target volume and verifies ARCHIVE.tar.gz.sha256 before writing it.
EOF
  exit 2
}

fail() {
  printf 'state transfer failed: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

require_command docker
require_command gzip
require_command sha256sum

[[ $# -eq 4 ]] || usage
mode=$1
volume=$2
archive=$3
helper_image=$4

docker image inspect "$helper_image" >/dev/null
docker volume inspect "$volume" >/dev/null 2>&1 \
  || fail "Docker volume does not exist: $volume"

running_containers=$(docker ps --filter "volume=${volume}" --format '{{.Names}}')
if [[ -n $running_containers ]]; then
  fail "stop containers using ${volume} before transfer: ${running_containers}"
fi

case "$mode" in
  backup)
    checksum_file="${archive}.sha256"
    manifest_file="${archive}.manifest"
    [[ ! -e $archive ]] || fail "archive already exists: $archive"
    [[ ! -e $checksum_file ]] || fail "checksum already exists: $checksum_file"
    [[ ! -e $manifest_file ]] || fail "manifest already exists: $manifest_file"

    archive_dir=$(CDPATH= cd -- "$(dirname -- "$archive")" && pwd)
    archive_name=$(basename -- "$archive")
    archive="${archive_dir}/${archive_name}"
    checksum_file="${archive}.sha256"
    manifest_file="${archive}.manifest"
    archive_tmp="${archive}.tmp.$$"
    checksum_tmp="${checksum_file}.tmp.$$"
    manifest_tmp="${manifest_file}.tmp.$$"
    trap 'rm -f "$archive_tmp" "$checksum_tmp" "$manifest_tmp"' EXIT
    umask 077

    docker run --rm \
      --user 0:0 \
      --entrypoint tar \
      --volume "${volume}:/source:ro" \
      "$helper_image" \
      -C /source -cf - . \
      | gzip -1 >"$archive_tmp"
    mv "$archive_tmp" "$archive"
    (
      cd "$archive_dir"
      sha256sum "$archive_name" >"$(basename -- "$checksum_tmp")"
    )
    mv "$checksum_tmp" "$checksum_file"

    helper_image_id=$(docker image inspect --format '{{.Id}}' "$helper_image")
    {
      printf 'source_volume=%s\n' "$volume"
      printf 'helper_image=%s\n' "$helper_image"
      printf 'helper_image_id=%s\n' "$helper_image_id"
    } >"$manifest_tmp"
    mv "$manifest_tmp" "$manifest_file"
    chmod 0600 "$archive" "$checksum_file" "$manifest_file"
    trap - EXIT
    printf 'Backed up %s to %s\n' "$volume" "$archive"
    ;;
  restore)
    checksum_file="${archive}.sha256"
    [[ -r $archive ]] || fail "archive is not readable: $archive"
    [[ -r $checksum_file ]] || fail "checksum is not readable: $checksum_file"

    archive_dir=$(CDPATH= cd -- "$(dirname -- "$archive")" && pwd)
    archive_name=$(basename -- "$archive")
    (
      cd "$archive_dir"
      sha256sum --check "${archive_name}.sha256"
    )

    if ! docker run --rm \
      --user 0:0 \
      --entrypoint /bin/sh \
      --volume "${volume}:/target" \
      "$helper_image" \
      -ec 'test -z "$(ls -A /target)"'; then
      fail "target volume is not empty: $volume"
    fi

    gzip -dc "$archive" \
      | docker run --rm -i \
          --user 0:0 \
          --entrypoint tar \
          --volume "${volume}:/target" \
          "$helper_image" \
          -C /target -xf -
    docker run --rm \
      --user 0:0 \
      --entrypoint /bin/sh \
      --volume "${volume}:/target" \
      "$helper_image" \
      -ec 'chown -R 10001:10001 /target'
    printf 'Restored %s into empty volume %s\n' "$archive" "$volume"
    ;;
  *)
    usage
    ;;
esac
