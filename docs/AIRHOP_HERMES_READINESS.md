# Hermes: delivery checklist after the 2026-09-05 review

This checklist distinguishes implemented code from deployed and accepted flows.
The project is not yet a complete parent-administrator product.

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
- Run the full corrected GitHub CI. Remaining Desktop smoke failures need explicit
  classification; they must not be dismissed wholesale as inherited test debt.
- Rebuild/redeploy the matching runtime and relay, then publish a matching desktop
  artifact. The existing 0.5.5 download predates the reviewed shell fixes.

## Product work remaining after that pilot

1. Consume single-use post-booking handoff grants and verify representative/family
   bindings, including approval by an existing representative for a second parent.
2. Add typed booking creation, auto-confirmation and actual atomic transfer;
   existing parent tools only cancel and request a transfer.
3. Finish branch responsibility routing, family-to-conversation navigation,
   canonical family/parent titles, and actionable staff inbox behaviour.
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

## Local verification on 2026-09-05

- `just ci`: passed (desktop build, native tests, unit checks, web and mobile gates).
- `just test`: passed after updating the Welcome transcript fixture to require
  the current HQ preview/owner-confirmation contract. This default command does
  not run all ignored relay integration tests.
- Dedicated PostgreSQL conversation lifecycle: 4 passed, explicitly run with
  `--ignored` against a separate test database.
- AirHop MCP: 13 passed, including a real HTTP mock proving the separate signed
  internal handoff event and the server-selected recipient.
- Gateway fake-provider tests: 9 passed; CI migration source guards: 2 passed.
- AirHop UI scenarios: 45 passed across the main run and targeted rerun (33 + 12).
  Fixtures now set their asserted locale, use the current settings sections and
  date input, and keep the booking/conflict/cancellation assertions intact.
- GitHub CI and real Telegram acceptance remain separate release gates.

Deployment order: migrate/start the matching relay first, then update the ACP,
AirHop MCP and Hermes runtime. The relay accepts old single-event claims, but
older relays do not understand the new batch candidate field or handoff batch.
