# Unified interface candidate — 2026-09-09

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

## Verification in progress

Dedicated PostgreSQL regression passed for two-community isolation, canonical
registration deduplication, inactive service protection and ordinary human removal.
Desktop unit/type checks and browser regression results are finalized below before
the candidate is declared built. Screenshots use the E2E native mock bridge; they
do not constitute native installed-app or real provider acceptance.

## Unified-source gate

Read-only demo inspection found deployed runtime recovery da09388809b1, newer than
this checkout's starting cd845075. The subsequent committed history fix f50d431f31c0
is also being prepared by the separate Hermes task. Both must be integrated before
freezing the common candidate, preserving shared-thread isolation in conflict areas.
An earlier image tag is not evidence that the candidate contains the latest code.

Final release identity must bind the clean committed source, public web, sidecars and
macOS app. Ad-hoc local signing is not notarization or a public release. A future
demo rollout requires matching relay, gateway, ACP/CLI/MCP and runtime/persona, backups
and real multi-client acceptance; it must not reuse the obsolete schema-54 rollout.
