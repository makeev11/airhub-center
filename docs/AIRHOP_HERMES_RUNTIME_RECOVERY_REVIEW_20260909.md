# Hermes runtime recovery review — 2026-09-09

## Scope and observed failure

The demo accepted the signed staff resume at 13:13 UTC and restored Hermes
ownership. Parent inputs at 13:14 and 13:17 were persisted, but no reply was
committed. The new ACP session had no history; upstream tool discovery replaced
the nine role tools with search/describe/call; the model ended without calling
`airhop_send_parent_reply`. The supervisor left that turn leased and discarded
subsequent claim conflicts instead of deferring the input.

## Changes under review

- The turn context contains a bounded, tenant/conversation/lease-scoped transcript,
  including earlier ownership cycles. Parent, Hermes and staff are labelled;
  undelivered/internal staff content is not represented as a delivered reply.
- Every observed prompt completion, panic cleanup and graceful shutdown finalizes
  the exact lease. Already committed replies and takeovers cannot be overwritten.
  Unsent turns may retry with rotated leases, at most three attempts. A staff
  resume with no pending parent input completes as a silent wait.
- Busy leases and transport failures defer input rather than dropping it or
  consuming the model retry budget. Shared context-grant files are serialized
  across channels, even if the pool is accidentally configured with several slots.
- Nine AirHop tools remain directly visible. Discovery and the real upstream
  tool assembler are checked separately, including a negative control for the
  former default. No shell, cross-family history or generic tools were enabled.
- Exact handover aliases cover the requested Russian phrases and common commands
  in several other languages. Quoted, negative and partial commands do not match.
- An optional server-side free-form intent fence checks signed staff membership,
  active deployment/route, current ownership version, recency and newer staff
  messages. This path defaults off and the demo rollout explicitly enables it.
  Coalesced parent messages retain their identity in the resumed cycle.

## Approval boundary

The operator explicitly approved sending up to 1,000 characters of the addressed
staff command to DeepSeek, including the risk of personal data typed into that
message. Only then was the classifier installed and synthetic provider eval run.
No customer history or booking tools were sent to the classifier. The explicit
opt-in is AIRHOP_STAFF_INTENT_ENABLED=1; default is off.

## Verification

- Actual DeepSeek synthetic evaluation: final 40/40 examples across 19 languages
  passed, including new holdout languages. Earlier runs exposed JSON wrapper
  ambiguity and immediate-stop precedence; both were corrected. Passing this
  sample is not a guarantee of universal accuracy or provider availability.
- CI also checks the exact prompt/case fingerprints against the successful
  synthetic provider baseline, so changing either requires a fresh evaluation.

- Final database run: all 31 conversation/booking integration tests passed
  against a dedicated local PostgreSQL database, including silent resume,
  expired competing leases, coalesced semantic resume, revoked staff and
  cross-channel denial. All 190 database unit tests also passed in the prior run.
- Final ACP run: 692 library tests passed, including real local HTTP finalization
  tests, expired-lease input recovery, classifier transport/schema/opt-in bounds,
  queue deferral and runtime configuration contracts.
- Pinned upstream Hermes assembly: isolated no-network container reproduced
  9 registered MCP tools becoming 3 bridges with the default setting, and verified
  all 9 remain direct with tool search disabled. No model or customer actions.
- Formatting, diff whitespace and Python smoke-test syntax checked.
- `cargo clippy --locked -p buzz-acp -p buzz-db -p buzz-relay --lib -- -D warnings`
  passed for all changed libraries.
- CI explicitly includes the ignored Postgres regression suite; runtime/config
  changes also trigger the Rust jobs. Image/live rollout preflight checks actual
  tool assembly, not only MCP discovery.
- Full `just test` was attempted but stopped: local Docker is not running, so
  its infrastructure gate cannot run. Dedicated PostgreSQL tests are independent
  of this limitation. No claim that full repository CI passed.

## Release boundary

Changes are isolated on `codex/hermes-runtime-recovery`; concurrent knowledge
workspace work and earlier desktop owner-label changes were not included.
Deployed to demo on 2026-09-09 at 16:51 UTC after explicit operator approval of
the destination (46.173.25.23), private-source transfer, backup and demo-only
rollout. Production and the Telegram gateway were not restarted.

- Source commit: `da09388809b1282b1f1f86ffe5e68a0f5d262909`.
- Relay and runtime release: `airhop-center-0.5.6-da09388809b1`.
- Source archive SHA-256: `46ec63de40c0a41c27c1aa5f3e080bc71585247082aae37f1b6fe7939ebb32f2`.
- Server release directory: `/opt/airhop/hermes-booking-da09388809b1`.
- Backup: `/opt/airhop/backups/demo-before-hermes-booking-da09388809b1`.
  Database dump was restored into an isolated preflight database and schema 55
  verified. No live migration, restore or booking operation was performed.
- Both services healthy; image and live MCP checks passed, with all nine tools
  directly assembled and the previous three-bridge regression reproduced by
  the negative control. Public assets, deployment controls and all neighboring
  container identities/start times matched the pre-rollout snapshot.
- Runtime opt-in verified: `AIRHOP_STAFF_INTENT_ENABLED=1`; provider credential
  presence checked without exposing its value. Pilot infrastructure check passed.
- Server free space after rollout: approximately 4 GiB. No pruning/deletion.

The isolated source commit must be included in subsequent releases; it was not
merged over concurrent knowledge/client-thread changes in the main worktree.
The guarded rollout script is now pinned to the previous `097799a4fd61` baseline
and must not be blindly reused for another release.

Real conversational acceptance still requires a real staff mention and parent
message. No synthetic messages, families or bookings were created in the user's
conversation. Server health does not prove desktop interaction performance;
the previous general UI-latency complaint is not claimed resolved by this rollout.
