# Airhop internal Hermes runtime

The four built-in Airhop team personas use the `airhop-hermes` runtime preset.
This packages Nous Hermes Agent commit `e624e9fde561e1add9388384012b295fde669ade`
with the same closed-toolset ACP patch as the existing parent runtime. There is
no second model loop or replacement Hermes memory implementation here.

```sh
. ./bin/activate-hermit
./scripts/install-airhop-hermes-team.sh
```

The installer requires `uv`, verifies the source archive SHA-256, installs the
upstream frozen dependencies with both `acp` and `mcp` extras, verifies the
toolset patch and runs `--check`. Optional positional arguments select a new
installation directory and a launcher directory. It refuses to replace an
existing installation. Add the launcher directory to the desktop login PATH.

Configure provider credentials through the existing agent environment settings.
For the current DeepSeek setup, `DEEPSEEK_API_KEY` selects provider `deepseek`
and defaults to `deepseek-v4-flash`. Explicit `AIRHOP_HERMES_PROVIDER` and
`AIRHOP_HERMES_MODEL` support other Hermes providers; the desktop's configured
provider/model are preserved. Credentials remain environment values and are
never written into the generated profile config. Missing model/provider setup
fails with a setup error instead of borrowing the personal Hermes profile.

Desktop supplies `AIRHOP_HERMES_RUNTIME_ROOT` under its application data
directory, partitioned by canonical relay authority and agent public key.
The wrapper forces separate `hermes/` and `workspace/` directories, disables
native cross-task profile/memory injection, configured MCP discovery and built-in
shell/browser/filesystem tools, and bounds model/tool iterations at 16. The only
injected product tools come from `airhop-agent-mcp`. Completed-task experience is
the separate, tenant-scoped structural procedure mechanism in Core.

Explicitly customized persona runtimes remain saved. Built-in team personas explicitly
using a generic runtime (including `hermes-acp`, Claude or Codex) must select
`Airhop Hermes` before starting: native host tools bypass the product graph.
The existing `buzz-agent` product MCP path remains supported. Generic, non-Airhop
personas remain unchanged. New and previously unset built-in runtime
choices use the pinned product preset.

```sh
python3 integrations/hermes-airhop-team-runtime/test_profile.py
python3 integrations/hermes-airhop-team-runtime/check_acp.py \
  /absolute/path/to/bin/airhop-hermes-acp
```

The second check exercises the actual ACP initialize/session creation protocol
with synthetic provider credentials and sends no model prompt. It validates the
runtime seam, not answer quality or an end-to-end live conversation. Existing
parent hosting continues to use its organization-isolated Docker runtime.

Internal chat workers currently run with the desktop lifecycle. The new relay
birthday/report worker runs independently of desktop uptime. This change does
not introduce a multi-organization hosted reconciler for all internal agents.
