# AirHop Center 0.5.7 unified interface candidate — 2026-09-09

Scope: local implementation and candidate assembly, not installation or deployment.
Preserves the knowledge workspace, client-thread model, analytics and simplified
agent identity presentation in this checkout.

## Implementation

- Semantic chrome/button/menu foregrounds, hover, active, keyboard focus and readable
  disabled states. Disabled employee removal explains the constraint inline.
- Shared reactive messenger RU/EN copy, selected-locale dates and grammatical counts.
  Locale changes do not remount the editor or translate authored names/messages.
  A read-only AST inventory is available in desktop/scripts/audit-messenger-copy.mjs.
- Migration 0058 adds a read-only principal registry view over actual AirHop team,
  Hermes and connector registrations. The existing authenticated staff-settings read
  exposes the current organization's agents and community service classifications.
- The channel picker reuses registered keys, never creates duplicate identities from
  global personas. Local controls match public key, relay and persona; remote registered
  agents are not falsely shown as running local processes.
- Employee filtering uses registrations/roles, not display names. Unnamed humans remain.
  Membership queries are scoped to community, relay and identity; stale data fails closed.
  The database also rejects ordinary role/removal operations on service identities.
- No harness/provider/model/effort configuration rules changed.

## Verification

- Desktop unit checkpoint: 4,495 passed. The final reactive-copy additions also have
  four passing dedicated unit tests, including unchanged authored names and RU/EN
  participant summaries. Typecheck and desktop checks passed.
- Browser E2E checkpoint: 28 passed (interface consistency, agent controls, settings
  localization, client inbox, knowledge workspace and analytics). Final rerun and the
  full `just ci` log are kept with local candidate verification evidence.
- Contrast scenarios cover six paired AirHop/Buzz/New Slack themes, normal/hover/
  active/focus/disabled navigation and destructive employee actions. The screenshot
  set contains 33 distinct images. Screenshots use the E2E native mock bridge; they
  do not constitute native installed-app or real provider acceptance.
- All 60 AirHop database regressions passed (group-directory test first, then the
  remaining 59 cases). They cover organization isolation, canonical registration
  deduplication, inactive service protection, human removal, knowledge publication,
  client routing, scoped Hermes history and semantic staff control. Use a fresh
  dedicated UTF-8 database: older fixtures retain fixed hosts and global notification
  queues. Run the group-directory global-horizon test first, then remaining AirHop
  cases; booking rejection fixtures intentionally leave invalid recurrence rules.
- The native WebDriver harness was not run: its Docker dependency is not running.
  No installed application, account, production data or real parent conversations
  were changed for these tests. Native/provider acceptance remains a release gate.

The copy audit is part of `pnpm check`, including a guard against translating labels
at module initialization (those labels would not react to a later language switch).
It also checks literal and conditional translation keys, and stable option label keys,
against the actual dictionaries. This caught three untranslated lowercase agent badges.

The unified release increments all four desktop version sources to 0.5.7. The source,
public form and native bundle share a full commit identity and migration 58. Packaging
of the earlier 8016bee7 checkpoint passed, including ad-hoc signature verification;
that checkpoint is superseded by the final 0.5.7 package, not a second release target.

## Unified-source gate

Read-only demo inspection first found runtime recovery da09388809b1, newer than this
checkout's starting cd845075, and subsequently the deployed history fix f50d431f31c0.
Both are integrated by merge b260fe54. Integration required semantic changes beyond
resolving textual conflicts: parent claim responses carry the canonical conversation
ID, ACP sessions follow that ID, history and staff-command batches are fenced to the
exact shared-channel thread. A later staff message in a different client's thread
cannot invalidate this client's command. Dedicated two-client regression tests pass.
No harness/provider/model/effort policy was altered by this integration.

Subsequent reviewed fixes from the parallel Hermes task are also included:

- Queue fix 436033ee was applied as 7feb51c9. Conversation bookings now appear next
  to website requests without changing confirmation, duplicate review or identity.
  The combined 60-test database suite passed after this integration.
- Surname fix fd1fe3ea was applied as e9daf8da, after its isolated regression suite
  passed. New families use explicitly supplied first/last names; verified families
  and booked receipts retain their existing identity. Old uncommitted drafts must
  show an updated summary and obtain fresh consent. The MCP schema, runtime persona
  and relay must be deployed together. No existing family is silently renamed.

Final combined CI, post-integration DB/MCP tests and artifact verification are recorded
alongside the final package; historical checkpoints above are not native live acceptance.

Post-integration checks passed: all 65 AirHop PostgreSQL cases (one group test,
then 64 remaining cases), 24 airhop-core unit/integration tests, 14 AirHop MCP tests,
15 ACP supervisor tests, 28 browser scenarios and 24 release-identity/asset-verifier
tests. Native frontend assets are frozen in the candidate's own directory and hashed
before and after Tauri compilation; CI cannot replace them via shared desktop/dist.
New in-progress widget redesign changes in the main checkout are explicitly outside
this frozen release. The completed development-only dev:booking helper is preserved;
the release public form still uses the server runtime, never demo data.

Observed demo base: `airhub-center-relay:airhop-center-0.5.6-f50d431f31c0`, Docker
config ID `sha256:a7c648e65e863ed32bfefc3e9ad96cb47f848e7687a0ba95e5fa18b361b43e94`.
An earlier image tag is not evidence that the candidate contains the latest code.

Final release identity must bind the clean committed source, public web, sidecars and
macOS app. Ad-hoc local signing is not notarization or a public release. A future
demo rollout requires matching relay, gateway, ACP/CLI/MCP and runtime/persona, backups
and real multi-client acceptance; it must not reuse the obsolete schema-54 rollout.
