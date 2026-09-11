#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage:
  ./image-transfer.sh export IMAGE_REF ARCHIVE.tar.gz
  ./image-transfer.sh load ARCHIVE.tar.gz [EXPECTED_IMAGE_REF]

Export refuses to overwrite existing files. Load verifies the adjacent
ARCHIVE.tar.gz.sha256 file before importing the Docker image.
EOF
  exit 2
}

fail() {
  printf 'image transfer failed: %s\n' "$*" >&2
  exit 1
}

require_command() {
  command -v "$1" >/dev/null 2>&1 || fail "required command is missing: $1"
}

require_command docker
require_command gzip
require_command sha256sum

mode=${1:-}
case "$mode" in
  export)
    [[ $# -eq 3 ]] || usage
    image_ref=$2
    archive=$3
    checksum_file="${archive}.sha256"
    manifest_file="${archive}.manifest"

    [[ ! -e $archive ]] || fail "archive already exists: $archive"
    [[ ! -e $checksum_file ]] || fail "checksum already exists: $checksum_file"
    [[ ! -e $manifest_file ]] || fail "manifest already exists: $manifest_file"
    docker image inspect "$image_ref" >/dev/null

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

    docker image save "$image_ref" | gzip -1 >"$archive_tmp"
    mv "$archive_tmp" "$archive"
    (
      cd "$archive_dir"
      sha256sum "$archive_name" >"$(basename -- "$checksum_tmp")"
    )
    mv "$checksum_tmp" "$checksum_file"

    image_id=$(docker image inspect --format '{{.Id}}' "$image_ref")
    source_revision=$(
      docker image inspect \
        --format '{{index .Config.Labels "org.opencontainers.image.revision"}}' \
        "$image_ref"
    )
    {
      printf 'image_ref=%s\n' "$image_ref"
      printf 'image_id=%s\n' "$image_id"
      printf 'source_revision=%s\n' "$source_revision"
    } >"$manifest_tmp"
    mv "$manifest_tmp" "$manifest_file"
    chmod 0600 "$archive" "$checksum_file" "$manifest_file"
    trap - EXIT

    printf 'Exported %s as %s\n' "$image_id" "$archive"
    ;;
  load)
    [[ $# -eq 2 || $# -eq 3 ]] || usage
    archive=$2
    expected_image_ref=${3:-}
    checksum_file="${archive}.sha256"
    [[ -r $archive ]] || fail "archive is not readable: $archive"
    [[ -r $checksum_file ]] || fail "checksum is not readable: $checksum_file"

    archive_dir=$(CDPATH= cd -- "$(dirname -- "$archive")" && pwd)
    archive_name=$(basename -- "$archive")
    (
      cd "$archive_dir"
      sha256sum --check "${archive_name}.sha256"
    )
    gzip -dc "$archive" | docker image load

    if [[ -n $expected_image_ref ]]; then
      image_id=$(docker image inspect --format '{{.Id}}' "$expected_image_ref")
      printf 'Loaded %s as %s\n' "$image_id" "$expected_image_ref"
    else
      printf 'Image archive loaded; inspect its imported tag before editing .env.\n'
    fi
    ;;
  *)
    usage
    ;;
esac
