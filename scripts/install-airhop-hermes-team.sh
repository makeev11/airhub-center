#!/usr/bin/env bash
# Install a separate pinned product runtime; never changes ~/.hermes or generic Hermes.
set -euo pipefail
repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
revision=e624e9fde561e1add9388384012b295fde669ade
archive_sha=60abc6fc064449fd596286dae20b1c105ad6aeb0d97d3036d950bef65a59af55
install_root=${1:-"${HOME}/.local/share/airhop/hermes-team-${revision}"}
bin_dir=${2:-"${HOME}/.local/bin"}
command -v uv >/dev/null || { echo 'Install uv before running this installer.' >&2; exit 1; }
if [[ -e "${install_root}" ]]; then
  echo "Destination already exists: ${install_root}. Choose a new directory; existing runtimes are preserved." >&2
  exit 1
fi
mkdir -p "${install_root}/runtime" "${bin_dir}"
install_root=$(cd "${install_root}" && pwd)
bin_dir=$(cd "${bin_dir}" && pwd)
archive=$(mktemp)
trap 'rm -f "${archive}"' EXIT
curl --fail --location --retry 2 "https://codeload.github.com/NousResearch/hermes-agent/tar.gz/${revision}" -o "${archive}"
printf '%s  %s\n' "${archive_sha}" "${archive}" | shasum -a 256 -c -
tar -xzf "${archive}" -C "${install_root}/runtime" --strip-components=1
patch -d "${install_root}/runtime" -p1 < "${repo_root}/integrations/hermes-airhop-parent-runtime/hermes-agent-acp-toolsets.patch"
uv sync --directory "${install_root}/runtime" --python 3.12 --frozen --no-dev --extra acp --extra mcp
cp "${repo_root}/integrations/hermes-airhop-team-runtime/entrypoint.py" "${install_root}/entrypoint.py"
cp "${repo_root}/integrations/hermes-airhop-team-runtime/airhop-hermes-acp" "${install_root}/airhop-hermes-acp"
chmod 755 "${install_root}/airhop-hermes-acp"
"${install_root}/runtime/.venv/bin/python" -c 'from acp_adapter.session import _expand_acp_enabled_toolsets as expand; assert expand([], ["airhop-agent-mcp"]) == ["mcp-airhop-agent-mcp"]'
"${install_root}/airhop-hermes-acp" --check
# A shell launcher preserves paths containing spaces; do not replace another install.
if [[ -e "${bin_dir}/airhop-hermes-acp" ]]; then
  echo "Launcher already exists. Runtime prepared at ${install_root}; select it explicitly." >&2
  exit 1
fi
printf '#!/usr/bin/env bash\nexec %q "$@"\n' "${install_root}/airhop-hermes-acp" > "${bin_dir}/airhop-hermes-acp"
chmod 755 "${bin_dir}/airhop-hermes-acp"
printf 'Installed Airhop Hermes runtime: %s\n' "${bin_dir}/airhop-hermes-acp"
