# Hermes: delivery checklist after the 2026-09-05 review

This checklist distinguishes implemented code from deployed and accepted flows.
The project is not yet a complete parent-administrator product.

## Online booking → Telegram slice implemented after the review

- Selecting Telegram on the public success page issues a 15-minute, one-use
  start link using the existing management credential and contact-channel action.
  Only its SHA-256 digest reaches Postgres and the gateway's durable inbox.
- Authenticated route resolution consumes the grant and binds the private
  conversation, representative and messenger account in one transaction, with
  a domain audit event. Raw start material never enters Buzz or model context.
  Same-chat retries are idempotent; revoked/expired/wrong-connection grants and
  cross-family bindings fail closed. A new unused grant revokes its predecessor.
- Anonymous web phone matches are duplicate-review signals, not family
  authentication. They no longer add children/bookings to an established family.
  New chats with existing-family/duplicate candidates require staff verification.
  Trusted staff exact-match workflows are unchanged. Historical bookings without
  the new identity provenance also require verification before family access.
- Hermes receives the server-resolved booking ID and auto-confirm policy.
  `confirm_online` checks the active lease, master booking permission,
  auto-confirm switch, verified handoff, current booking/occurrence, capacity,
  age, visit policy, consent and duplicate-review signals. Only a committed Core
  result permits a confirmation message. Other outcomes go through staff handoff.
- The existing Hermes card includes an auto-confirm switch, on by default;
  older supervisors preserve an explicitly disabled setting when updating state.
- The success page distinguishes connection from confirmation and polls both
  for a bounded time. Verified conversations have family/parent titles, and staff
  family cards link only to conversations the current staff principal can read.

This is implemented and locally testable, **not a claim of live Telegram
acceptance or an updated public installer**. Apply migration 0052 and deploy
matching Relay, gateway, MCP/persona and frontend before live acceptance.

## Review fixes implemented on the integration branch

- Staff resume understands the current display name, including the profile
  inserted by the mention autocomplete. Identity still requires the signed p tag.
- Resume creates a server-authorized internal trigger in a new ownership cycle;
  the staff command is not delivered to the parent. A disabled channel connection
  or channel-level Hermes switch cannot be bypassed by a staff resume.
- The existing ACP batch is claimed in one request. The relay chooses a current
  trigger in the same channel, so a trailing internal note does not swallow the
  parent's question or the staff resume. No additional LLM loop is introduced.
- `airhop_send_parent_reply(handoffReason=...)` atomically commits parent replies,
  one internal staff mention, and human ownership. It selects the owner/admin
  fallback already authorized to read the conversation. Branch responsibility
  configuration is not implemented by this fallback.
- Unsupported Telegram attachments create visible durable notices. The original
  file and voice transcription remain unavailable; the agent must explain this
  and request text, not pretend that it or the employee has read the original.
- CI uses the same embedded migration chain as the relay instead of the old
  Buzz schema snapshot. Real PostgreSQL lifecycle tests and fake-provider
  gateway tests are registered in CI.

## Acceptance still required

- Run a real Telegram bot through connection, first contact, reply, staff takeover,
  tagged resume, internal handoff, disconnect/restart, and duplicate-delivery cases.
- Include coalesced parent messages mixed with internal staff notes in the live
  Telegram acceptance, in addition to the PostgreSQL batch-selection regression.
- Keep the full corrected GitHub CI green on release candidates. The complete
  CI passed for `f9730f5` after merging the current main branch, including live
  relay integration and both AirHop product UI shards. All 89 local AirHop UI
  scenarios also passed in one clean run.
- Rebuild/redeploy the matching runtime and relay, then publish a matching desktop
  artifact. The existing 0.5.5 download predates the reviewed shell fixes.

### Live acceptance for the online-booking Telegram slice

Use a dedicated test organization and parent account. Do not send messages to
real families as deployment smoke checks.

1. Deploy matching Relay with migration 0052, channel gateway, parent runtime /
   MCP / persona, and public frontend. Connect a test bot in the existing Center
   channel settings; enter its token there, never in a support conversation.
2. Enable Hermes and booking management in the existing agent card. Verify the
   new auto-confirm switch defaults to on. Create a future online booking with a
   new test parent's details and select Telegram on the success page.
3. Opening the link alone must not bind anything. Press Start: the same private
   conversation acquires the family/parent name; its family card links to it.
   Hermes reads the booking, receives a successful Core confirmation, then sends
   the actual date, time and address. The browser separately reports connection
   and the confirmed booking status.
4. Repeat Start and restart the gateway: do not create a second binding, audit
   event or confirmation. Try a new test booking with auto-confirm off; Hermes
   must pass it to staff and leave it pending. A staff answer pauses Hermes;
   only a signed internal @mention to continue resumes it.
5. Try an expired/revoked link, a link for another family in an already bound
   chat, and an anonymous booking using an existing family's phone. Do not reveal
   family history or auto-confirm a duplicate-review case. A cancelled/full
   occurrence must fail Core confirmation without a false success message.

Record real provider delivery and staff takeover evidence before declaring this
slice accepted. Fake-provider tests do not prove live provider or LLM behaviour.

## Product work remaining after that pilot

1. Add existing-parent approval/verified contact flows for returning and second
   parents. The first-booking Telegram grant does not replace those proofs.
2. Add typed conversational booking creation and actual atomic transfer;
   parent tools now confirm an online handoff, cancel, and request a transfer.
3. Finish branch responsibility routing and actionable staff inbox behaviour;
   family navigation and simple family/parent Telegram titles are implemented.
4. Provide user-editable published knowledge, factual payment guidance, booking
   and payment reminders with current-state checks before each delivery.
5. Add voice transcription and a protected staff-accessible attachment path.
6. Implement the official WhatsApp Cloud adapter and its delivery policies;
   validate the Brazilian Portuguese end-user path.
7. Implement Family-scoped memory and a reviewed learning pipeline. Keep the
   profile-wide memory disabled until family isolation is proven.
8. Complete the HQ provisioning workflow, operational alerting and restore tests,
   and signed/notarized installers for low-friction distribution.

Do not replace Buzz, Booking Core, or Hermes with a new framework for these steps.
Extend the existing authenticated event, tool, and outbox seams with end-to-end tests.

## Local verification on 2026-09-05 (after the online-booking slice)

- `just ci`: passed (desktop build, native tests, unit checks, web and mobile gates).
- `just test`: all 11 suites passed. This default command does not run all
  ignored relay integration tests.
- Dedicated PostgreSQL conversation lifecycle: 9 passed, explicitly run with
  `--ignored` against a separate test database. Includes binding/confirmation/
  reply, idempotent audit, policy off, cancelled occurrence, expired/revoked grant,
  foreign connector, cross-family conflict, anonymous phone match and staff
  takeover fences. The deployment opt-out compatibility unit test also passed.
- Gateway fake-provider tests: 13 passed, including durable Start replay,
  invalid/conflicting grants and redaction of pasted links without authentication.
- Relay AirHop unit/HTTP-contract tests: 65 passed, including the typed online
  confirmation action and rejection of caller-supplied policy overrides.
- AirHop MCP: 13 passed, including the signed internal handoff and
  server-selected staff recipient contract.
- Focused desktop HTTP, settings, family-card and success-rendering tests:
  16 passed. Desktop lint, file-size and text-size guards passed after final edits.
- AirHop UI scenarios: 89 passed in one clean Playwright run after merging main. Uses the E2E bridge
  and demo state, not a live provider. New success-state rendering tests separately
  distinguish the launch link, connected chat and authoritative confirmation.
- Full GitHub CI passed for `f9730f5`, including relay-backed product tests.
- The additional PostgreSQL public-booking lifecycle test passed after replacing
  its obsolete anonymous phone-based identity-reuse expectation with isolation
  and duplicate-review assertions. It is now included in the CI integration gate.
  This follow-up changes tests/documentation/CI only, not the runtime images.
- Real Telegram acceptance remains a separate release gate.

Deployment order: migrate/start the matching relay first, then update the ACP,
AirHop MCP and Hermes runtime. The relay accepts old single-event claims, but
older relays do not understand the new batch candidate field or handoff batch.
