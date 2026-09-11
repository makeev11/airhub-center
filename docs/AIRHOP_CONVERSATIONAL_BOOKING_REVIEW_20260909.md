# Conversational booking: review and demo deployment

Scope: new-contact intake, parent consent, atomic booking creation, current
Hermes controls, identity isolation, role-scoped tools and demo rollback.
This is a local code review, not an independent-agent review or live acceptance.

## Findings fixed before rollout

1. **P1 — a later unrelated “yes” could authorize an old summary.** The original
   guard checked that a summary had been delivered, but not that the reply was
   its direct answer. Reproduced with “do not book yet” followed by “yes”; the
   regression failed before the fix. Commit now rejects intervening parent
   messages and later delivered parent-facing replies. Persona/tool instructions
   require the exact summary to be the last message before confirmation.
2. **P2 — delayed processing could outlive the draft's 24-hour validity.** The
   original guard checked the source message's time only. It now also checks
   current database time. A backdated valid-at-arrival confirmation cannot create
   a booking after expiry; the parent must review a fresh summary.

Regression coverage includes both findings, a later question in the same output
batch, staff takeover/resume, disabled controls, changed prices/age rules, scoped
existing children, duplicate phones, concurrent retries and a site/chat race
for the last seat. Booking/identity/consent/audit/outbox writes share one
transaction. A new chat never authenticates someone else's family by phone.

## Operational boundary

- Target: `root@46.173.25.23`, **only** `buzz-demo` relay and Hermes runtime.
- Verified baseline: relay `airhop-center-0.5.6-4322563f72a7`, migration 54;
  Hermes `f9730f5`; booking management and auto-confirm already enabled.
- Use immutable committed sources and retain the exact old relay/Hermes images.
  The dedicated Dockerfile reuses the verified compiler/dependency layer, caps
  Rust jobs at one, preserves all public assets and the upstream Hermes runtime.
- Back up DB/config/runtime state, restore to a separate preflight database,
  and validate additive migration 0055 before replacing the live relay. Pause
  only the Hermes runtime while taking its state snapshot and running preflight.
- Rollback restores old images with `BUZZ_AUTO_MIGRATE=false`; never downgrade
  or restore over the live DB. Keep new bookings and additive schema intact.
- Production, gateway, databases/storage, public installer and the installed
  Mac app are outside this rollout. No synthetic customer booking or external
  message is to be sent as a smoke check without separate authorization.

Remaining acceptance: a real parent's new message after deployment must traverse
the actual model and Telegram provider. Tool discovery and health checks alone
do not prove that end-to-end behavior.

## Deployment completed, 2026-09-09 13:09 UTC

User-approved target: `demo.airhop.ru`, Compose project `buzz-demo` only.
Source commit: `097799a4fd6122a1de0c81761277bb23f87e831f`, signed off on
`codex/hermes-conversation-booking`. No Git push or public installer release.

- Release: `airhop-center-0.5.6-097799a4fd61`.
- Source archive SHA-256:
  `50bccd0bd173f16ca414161d9caa9da10b91b0a88ebf040292b09d697b632712`.
  All 3,412 selected committed source files were checked on both hosts.
- Relay image: `airhub-center-relay:airhop-center-0.5.6-097799a4fd61`;
  Docker image ID `sha256:356f75e1c6e8c495b0e98d48a63e1cf67e53654974deeba515932e436d1bb28e`.
- Hermes image: `airhop-hermes-parent-runtime:airhop-center-0.5.6-097799a4fd61`;
  Docker image ID `sha256:66a161ae734b3c6d7181e40c75fb0b1baba2d2f98f3f5dc2526e582a24e6763c`.
- Server-side receipt and release artifacts:
  `/opt/airhop/hermes-booking-097799a4fd61/rollout-result.json`.
- Restricted backup directory:
  `/opt/airhop/backups/demo-before-hermes-booking-097799a4fd61`.
  Contains database dump, original configuration, stopped Hermes state,
  image identities, preflight and postflight evidence. The dump was fully
  restored into the separate `buzz_booking_preflight_097799a4fd61` database;
  migration 0055 succeeded there before the live relay was replaced.

Postflight passed: migration 55; relay and Hermes healthy; HTTPS health, catalog
and booking page; unauthenticated agent backend rejected with HTTP 401;
all nine role-scoped MCP tools discovered in both isolated and live runtime;
fresh Telegram gateway readiness; secret isolation; unchanged public-file hashes.
Startup logs contained zero ERROR/WARN entries at the postflight check.
The existing booking keyring is present. Hermes controls remain enabled,
not globally paused, booking management on, auto-confirm on, version 1.

Every neighboring running container retained its ID and start time, including
production relay and the Telegram gateway. No credentials or public assets
were replaced, and no Docker cache/images were pruned. About 5.3 GiB remained
free after deployment. The separate local test PostgreSQL was stopped.

The existing conversation remains human-owned and paused, deliberately preserved.
Resume by selecting the actual Hermes `@mention` and writing `продолжай`.
`забирай` is not a supported control command. Resume is an internal trigger,
not parent consent to create a booking. No synthetic parent messages or bookings
were sent; live model/provider booking acceptance remains outstanding.

The 22 dedicated PostgreSQL conversation regressions and the separate public
booking atomicity/idempotency/identity-isolation regression passed. Core, CLI and
DB unit suites were rerun successfully against the committed source. See the
readiness checklist for the other local checks and the full-suite limitation.

### Current deployment configuration and rollback

This list supersedes historical demo Compose instructions in the readiness
document. Use project `buzz-demo`, the existing env file
`/opt/airhop/buzz-demo/source/deploy/compose/.env`, and `hermes` / `telegram`
profiles, with these files in order:

1. `/opt/airhop/buzz-demo/source/deploy/compose/compose.yml`
2. `/opt/airhop/buzz-demo/buzz-demo.override.yml`
3. `/opt/airhop/relay-build-f9730f5/deploy/airhop/compose.existing.yml`
4. `/opt/airhop/buzz-demo/releases/f9730f5.compose.yml`
5. `/opt/airhop/buzz-demo/releases/analytics-demo-20260907.compose.yml`
6. `/opt/airhop/relay-build-0.5.6-4322563f72a7/demo-0.5.6.compose.yml`
7. `/opt/airhop/hermes-booking-097799a4fd61/rollout.compose.json`

For an explicitly authorized rollback, use `rollback.compose.json` from the same
directory instead of the final rollout override. Recreate only `relay` and
`hermes-parent-runtime` with `up -d --no-deps --wait --wait-timeout 180`.
This restores the retained old images with automatic migrations disabled;
it does not restore over live data or remove migration 55. The guarded rollout
script is intentionally one-shot and must not be rerun as a generic restart.
