#!/usr/bin/env bash

set -euo pipefail

expected_docker_fingerprint="9DC858229FC7DD38854AE2D88D81803C0EBFCD88"
docker_key_path="/etc/apt/keyrings/docker.asc"
docker_source_path="/etc/apt/sources.list.d/docker.sources"

fail() {
  printf 'bootstrap failed: %s\n' "$*" >&2
  exit 1
}

if [[ ${EUID} -ne 0 ]]; then
  fail "run as root on the new Brazilian VPS"
fi

if [[ ! -r /etc/os-release ]]; then
  fail "/etc/os-release is missing"
fi

# shellcheck disable=SC1091
. /etc/os-release
if [[ ${ID:-} != "ubuntu" || ${VERSION_ID:-} != "24.04" ]]; then
  fail "expected plain Ubuntu 24.04, found ${ID:-unknown} ${VERSION_ID:-unknown}"
fi
if [[ -z ${VERSION_CODENAME:-} ]]; then
  fail "Ubuntu VERSION_CODENAME is missing"
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends ca-certificates curl gnupg

install -m 0755 -d /etc/apt/keyrings
key_tmp="${docker_key_path}.tmp.$$"
trap 'rm -f "$key_tmp"' EXIT
curl --fail --silent --show-error --location \
  https://download.docker.com/linux/ubuntu/gpg \
  --output "$key_tmp"

actual_fingerprint=$(
  gpg --show-keys --with-colons "$key_tmp" \
    | awk -F: '$1 == "fpr" { print $10; exit }'
)
if [[ $actual_fingerprint != "$expected_docker_fingerprint" ]]; then
  fail "unexpected Docker repository signing-key fingerprint"
fi
install -m 0644 "$key_tmp" "$docker_key_path"
rm -f "$key_tmp"
trap - EXIT

architecture=$(dpkg --print-architecture)
cat >"$docker_source_path" <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: ${VERSION_CODENAME}
Components: stable
Architectures: ${architecture}
Signed-By: ${docker_key_path}
EOF

apt-get update
apt-get install -y --no-install-recommends \
  docker-ce \
  docker-ce-cli \
  containerd.io \
  docker-buildx-plugin \
  docker-compose-plugin

systemctl enable --now docker
docker version >/dev/null
docker compose version >/dev/null

install -d -m 0700 /opt/airhop
install -d -m 0700 /opt/airhop/backups
install -d -m 0700 /opt/airhop/whatsapp-edge

if command -v ss >/dev/null 2>&1; then
  occupied_ports=$(
    ss -H -ltn \
      | awk '$4 ~ /:(80|443)$/ { print $4 }' \
      | sort -u
  )
  if [[ -n $occupied_ports ]]; then
    printf 'warning: public HTTP ports are already occupied:\n%s\n' "$occupied_ports" >&2
  fi
fi

printf '%s\n' \
  "Host bootstrap passed." \
  "Next: configure the Hostinger firewall, copy the edge bundle, and load the accepted gateway image." \
  "Do not expose TCP 8443 publicly."
