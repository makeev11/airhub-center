# Internal agent conversation access

Organization owners/admins edit **AI agents → Access, duties and schedule →
Agent conversations**. Communication is one versioned field of the existing
signed `SetAgentPolicy` command, not a separate local agent preference.

- Audience: active center employees, current owners, or an explicit employee list.
- Surface: channels, direct messages, or both.
- In a one-agent DM, ordinary messages work without a textual mention. Other
  stream channels require an explicit agent recipient. Welcome retains its
  deterministic role routing. Ambiguous multi-agent DMs fail closed.
- The agent and human must already be current conversation members. These
  settings never invite an agent or add people to a channel.
- External/client conversations continue to use the independently scoped parent
  runtime. An internal agent's new policy does not grant access to those clients.

## Authority and compatibility

Missing/null `communication` preserves legacy Welcome/local-author behavior;
opening the editor does not enable broader access. A new broad default requires
a separate product decision. Old-client duty saves cannot erase an explicit
communication policy. Old clients that do not understand an explicitly saved
policy must be upgraded with the relay and bundled ACP/MCP binaries.

The relay authenticates the current registered agent and claims a persisted
human source under the current audience and surface policy. An explicit server
decision supersedes the local owner-only author filter **only for that event**.
Generic managed-agent configuration and its capability catalog are unchanged.

MCP binds the graph/cache to the exact task and channel. Reads and sends recheck
the route, including membership removal and policy revocation. Sending through
HTTP, WebSocket or the CLI uses the same publication guard. Reply receipts are
atomic across workers and restarts in every authorized conversation.

Internal destinations cannot include clients, unknown services or other external
readers. Open channels additionally require server-enforced relay admission;
private streams and DMs work on either kind of relay.

Welcome delegation carries an `airhop-human-source` proof and rechecks the human
against both Fizz and the specialist's policy. Old tasks without human evidence
cannot enter a role with an explicit communication policy. Delegation and setup/
website confirmation workflows remain in Welcome; ordinary conversation access
does not move those approval workflows or copy private DM content there.

## Verification

- Core/TypeScript tests cover strict audience lists, separate surfaces, and no
  implicit grant on legacy policy parsing.
- `agent_conversation_tests` uses an isolated `BUZZ_TEST_DATABASE_URL`: owner,
  staff and selected users; unmentioned DMs versus stream mentions; source/channel
  mismatches; membership revocation; external readers; and duplicate publication.
- MCP tests use a local fake relay for DM context/read/send and revoked access.
- ACP tests check pre-queue route enforcement, explicit policy decisions and
  unchanged generic-agent behavior.
- Desktop acceptance: `airhop-agent-controls.spec.ts`, built in E2E mode, checks
  employee selection, saved state, role duties and permission/version conflicts.

Deployment requires additive migration **0067**, the updated relay, and updated
desktop/ACP/MCP. No production permissions or runtime are changed by these tests.
