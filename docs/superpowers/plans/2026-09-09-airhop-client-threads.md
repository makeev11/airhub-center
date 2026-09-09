# Client conversations in shared work channels

Status: implemented locally; verification recorded in
`../reviews/2026-09-09-airhop-client-threads.md`. No deployment or live migration
was performed in this step.

## Decision

Connection configuration owns the physical private parent channel. A branch connection
uses its active branch's working channel; a central connection uses one organization-wide
`parents` channel (or an explicitly selected private channel). Provisioning is an
owner/admin operation, never an agent tool or per-contact side effect.

The provider identity resolves to a stable ExternalConversation. Route resolution may
reserve the conversation before delivery; its root remains null until the first signed
inbound is atomically accepted with its dedup receipt. Concurrent root candidates are
rejected before insertion and must resolve the accepted root before signing a reply.
Never mutate an accepted signed event. Subsequent messages are NIP-10 replies, using
the existing thread metadata/counter transaction.

`channel_id + root_event_id` identifies location; `branch_id`, assignee and queue status
identify responsibility. Branch assignment changes metadata only, with expected version,
idempotency and audit. Assignment never grants channel access. Central-channel members
can read all client threads in that channel; this must be explicit in setup.

Hermes batches, persisted ACP sessions, fresh turn scopes, booking confirmation evidence
and outbound validation must all be conversation-scoped before shared routing is usable.

## Legacy migration protocol

1. Owner/admin explicitly configures and validates the destination connection channel.
2. Preview resolves exact conversation, original channel, destination, membership and
   outstanding work. No guessing by channel display name; only canonical route rows.
3. Apply supplies expected conversation/route versions, an idempotency key and a signed
   service root in the destination. Preserve conversation, family, bookings and cycles.
4. In one transaction lock conversation and route; reject active delivery leases,
   pending deliveries and live Hermes turns. Require operator to drain/reconcile first;
   do not silently discard undelivered parent messages.
5. Insert the signed service root with an explicit old-history link; retain old channel
   and all original signed events. Store a permanent old-location record; archive the
   old channel. Bump control and routing versions and update the existing conversation
   location atomically. Fence any stale intent against the new location/version.
6. Exact replay returns the original result; stale/different requests conflict. Old
   channel events cannot acquire a new outbound route. No copied messages are presented
   as original history. No data migration runs implicitly at relay startup.

## Verification gates

- Database: tenant and membership fences, central singleton, branch routing, concurrent
  resolution/first inbound, dedup, counters, assignment and reopening, migration replay.
- Runtime: thread tags, rejected-root retry, batch/session isolation, threaded final
  replies/handoff, confirmation evidence never crosses conversations.
- Desktop: connection setup, Clients queue/filter/search, exact thread links from
  family/booking, no per-contact sidebar channel.
- Relevant unit/integration/E2E suites, formatting, `just ci`; record actual results
  and remaining blockers separately from implemented code.
