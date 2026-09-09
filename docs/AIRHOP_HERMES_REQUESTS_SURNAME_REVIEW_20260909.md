# Hermes requests and family surname review — 2026-09-09

## Findings

- A conversation booking can legitimately reserve capacity with status
  `pending_confirmation`. A matching phone creates a duplicate-review signal;
  it does not authenticate the sender as the existing family. Auto-confirmation
  remains disabled for that identity-review case even when the deployment's
  auto-confirm setting is on.
- The staff queue incorrectly accepted only `source.workflow = request`.
  Hermes writes `source.workflow = conversation`, so its persisted booking
  appeared in the lesson roster and family but disappeared from Requests.
- Booking decisions without a verified messenger account route follow-up to
  `StaffCall`. The assistant must not promise an automatic Telegram reply in
  that situation.
- Conversation intake previously had only `parentName`. The representative
  table already supports structured first/last names, but Hermes did not
  collect them for the family label.

## Changes and safety boundaries

1. The staff read projection includes website and conversation requests.
   Direct enrollments remain excluded; tenant scope, priorities, pagination,
   duplicate flags and decision authorization are unchanged. Existing bookings
   become visible without rewriting them or changing confirmation status.
2. New-family drafts require explicitly supplied `parentFirstName` and
   `parentLastName` before producing a ready summary. Missing fields remain
   collecting. The server derives the parent's display name and creates
   `Семья <surname>`, preserving compound names. It does not infer declension,
   split legacy display names, or assign the parent's surname to the child.
3. Verified family profiles are authoritative, including legacy profiles with
   null structured names. This booking flow does not rename existing families.
   Old uncommitted drafts without a surname require an updated summary and new
   parent consent. Existing booked receipts retain idempotent replay semantics.
4. MCP schema/tool guidance and the Hermes persona describe these requirements
   and distinguish created requests from confirmed bookings.

No migration, live booking confirmation, duplicate merge, profile backfill,
customer notification, production change or server rollout was performed for
this follow-up. Relay and Hermes runtime must be released together for the new
intake contract; the queue-only commit can be released independently.

## Regression coverage

- Staff queue red/green against isolated Postgres: before the fix, conversation
  rows vanished (`[]`); after the fix the same test passes. Covers pending and
  confirmed filters, attention, priorities, tenant isolation and exclusion of
  direct enrollments. This ignored integration test is now selected by CI.
- Real conversation creation checks queue visibility both with auto-confirm
  switched off and with a duplicate phone. Duplicate cases stay unbound and
  require staff review.
- Surname integration tests cover incomplete names, compound surnames,
  persistence, no automatic child surname, idempotency, changed-summary consent,
  pre-upgrade drafts and verified legacy profiles.
- Unit tests cover legacy JSON compatibility, malformed/overlong names and
  forwarding structured fields through the signed MCP backend operation.

Test logs are local under `/private/tmp/airhop-hermes-surname-*.log` and
`/private/tmp/airhop-hermes-queue-*.log`. The test database and build target are
isolated from the main checkout and running services. Full-repository CI is
coordinated separately with the shared release task.

Completed validation:

- PostgreSQL: 41 external-conversation tests, the staff-queue regression and
  the public-booking atomicity/identity regression pass (43 total).
- Rust library tests: 190 buzz-db, 16 airhop-core and 13 AirHop MCP tests pass.
- Both CI/migration-wiring Node tests pass.
- `cargo fmt --all --check`, `git diff --check` and Clippy with `-D warnings`
  for airhop-core, buzz-db and buzz-dev-mcp libraries pass.

Rollout remains separate from this source/test review. After the relay update,
reopen Requests or reload its list: existing conversation bookings should appear
under New / Needs attention according to their current status. Confirming them
and resolving duplicate identities are staff decisions, not part of this fix.
