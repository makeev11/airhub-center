# Conversational booking: pre-deployment review

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
