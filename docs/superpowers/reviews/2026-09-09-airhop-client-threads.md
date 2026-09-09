# Shared client threads — local implementation, 2026-09-09

Status: implemented in the same checkout as the knowledge workspace. Not deployed,
not installed on the Mac, no real customer message or legacy migration performed.
The working tree also contains concurrent messaging/profile changes; this is not
yet a frozen, committed release candidate. No version rollback was performed.

## What changed

- Connection setup selects an existing active private channel. Branch connections
  default to the branch work channel. Central setup creates/reuses one organization
  `parents` channel, never one channel or fictitious user per external contact.
- Route resolution reserves the stable conversation. Its first authenticated signed
  inbound atomically creates the root and provider receipt. Further client, Hermes
  and staff messages use existing NIP-10 replies in the same channel/root.
- Branch, assignee and waiting/resolved state are operational metadata, not access
  controls. Branch assignment is an audited, idempotent, versioned Nostr command
  (kind 9051). Configured responsible members receive actual internal mentions;
  otherwise an already authorized owner/admin is selected. Assignment grants no access.
- Hermes can select a branch only with current authenticated parent evidence and a
  live supervisor lease. Batches, reusable agent sessions, booking evidence and final
  replies are conversation-scoped. A static context grant cannot bypass the live
  queue supervisor; hosted listening requires the rotating grant file.
- Family/representative/booking binding changes the client title, not the channel
  name or root. New cycles and reopening preserve the same conversation.
- Center has **Обращения**: branch/unknown, status, connection, current or selected
  staff filters, bounded title search, pagination, exact thread links, roster setup
  and explicit legacy-migration preview. Family and booking cards open the same thread.
- Inbound alerts are durable jobs. Internal mentions never enter the provider outbox.
  Missing recipients defer a job for 60 seconds instead of blocking subsequent work;
  failed Redis publication leaves dispatch pending. Client reconnect can recover the
  already stored canonical event. This is at-least-once fan-out, not a claim that an
  OS notification can be delivered exactly once.
- Disabling a connection stops new delivery claims and preserves history. A provider
  network call already in flight cannot be recalled; operators must reconcile it.

## Legacy migration

Owner/admin explicitly configures the destination, previews exact conversation and
route versions, then confirms migration. Pending/leased deliveries, unpublished
replies or live Hermes turns block it; messages are never silently discarded.

One database transaction creates a signed service root linking original history,
retains the conversation/family/bookings/cycles, archives the old channel, records
its permanent old location and bumps the existing provider route/control versions.
Original signed events are not rewritten or copied as originals. Old-channel output
is rejected. Already accepted provider receipts remain replayable after cutover;
only an explicit pre-insert `airhop_thread_changed` rejection permits re-signing.
An uncertain network result always retries the exact signed event.

Migration 0057 only changes schema on relay startup. It does **not** automatically
migrate customer conversations. It follows knowledge migration 0056. The final
unreleased schema was tested on a fresh isolated database, not a live database.

## Verification

- Full `just ci`: **passed**, including root/desktop/web/mobile checks, unit suites,
  desktop and web builds, native macOS tests, and mobile tests (1,138 passed, one
  repository-declared skip). Repository-declared native/environment skips remain skips.
- Final follow-up after hardening: workspace all-target Clippy and formatting,
  desktop checks/build, and the database suites below are checked separately; no
  unrelated pipeline failures are concealed by the main CI result.
- Dedicated PostgreSQL 18 on loopback port 56567: **5 thread tests passed**;
  synthetic data, no application `.env`
  database used. Thread tests cover central singleton, branch routing, concurrent
  first contact/root, receipts, membership/tenant isolation, assignment/filtering,
  reopening, parent evidence, wrong-root replies, durable notifications and migration.
- Existing external-conversation/booking integration suite: **23 passed**, including
  new-family binding without replacing a shared root, existing-family reuse, capacity
  races, consent, handoff/takeover/resume and cross-tenant rejection.
- Knowledge publication/privacy/version/retry integration regression: **1 passed**
  on the same final schema. Isolated test database: `airhop_threads_final`.
- ACP unit suite: 683 passed, plus the final live-queue fail-closed regression.
  CLI: 317 passed. MCP: 110 passed. Gateway Python: 14 passed.
  Gateway tests use its `.venv/bin/python` with `PYTHONPATH=src`; system Python lacks
  `coincurve` and is not the configured project test environment.
- Complete desktop unit suite passed through CI; focused mutation retry tests: 2 passed.
- Final browser regression: **13 passed** across Inbox (3), knowledge workspace (8)
  and analytics (2). Built with `pnpm build:e2e`, native mock bridge and HTTP fixtures.
  Real SQL persistence is covered separately, not inferred from browser fixtures.
- Visual QA: `desktop/test-results/client-inbox.png`, inspected after adding staff
  filtering. `git diff --check` passed.

The general `just test` wrapper was not run against the checkout's configured shared
database: it sources `.env`, starts infrastructure and applies migrations. Relevant
database integration tests were run directly against isolated PostgreSQL instead.
Real signed HTTP/WebSocket + provider/agent deployment acceptance remains below.
The temporary PostgreSQL process was stopped after verification; no test or customer
data was deleted, and no shared development database was migrated.

## Release gates and known limits

1. Review concurrent changes together, commit one candidate and record its exact
   source/artifact identity. Do not install this dirty checkout as a release.
2. Back up demo data; deploy matching schema/relay, gateway, CLI/MCP, ACP/persona and
   desktop candidate together. Restart/version-check agent processes and grant-file
   configuration. Old runtime binaries are not compatible with shared client threads.
3. On demo, test two real parent identities simultaneously: first contact, late branch
   choice, knowledge answer, booking, human takeover/resume, disconnect/retry and
   connection disable. Verify no cross-client context or internal-note delivery.
4. Preview one actual legacy conversation, drain its outstanding deliveries, explicitly
   migrate and verify original history, new replies and old-channel rejection. Confirm
   private-channel visibility with real staff accounts before wider rollout.
5. Smoke-test the installed Mac candidate, including knowledge document import/export,
   sidebar sections and notifications. Production rollout follows this acceptance.

Inbox search currently matches the current client/family title, not typo-tolerant
full-history search. Shared-channel membership deliberately permits reading all its
threads; branch filters are not privacy isolation. Telegram gateway tests do not
establish live WhatsApp Cloud adapter acceptance, which needs its own configured
provider run. No deployment/readiness claim is inferred from these local checks.
