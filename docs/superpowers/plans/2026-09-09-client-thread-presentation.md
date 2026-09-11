# Client conversation presentation and mention correctness

Status: implemented locally and targeted checks passed; not released or installed.

## Final local follow-up, 2026-09-09

- Replaced the first-page-only channel lookup with debounced shared visible-root
  registration in the existing channel query cache. Requests contain at most 100
  exact roots and are serially batched; old roots retain channel/tenant fences.
  No module-level community cache was introduced.
- Thread title, reply placeholder and reply-target label use the same projection.
- Added Russian feedback copy, honest server-admin delivery disclosure, Russian
  community menu actions and connection labels. Replaced the default bee with
  the existing vector Send icon in profile/sidebar; saved organization names and
  custom icons are preserved. Feedback categories and routing did not change.
- Eight database integration tests passed against isolated local PostgreSQL on
  port 55439 (now stopped), including exact-root filtering and malformed/oversize
  input. Six browser tests passed, including Russian feedback and the named card;
  screenshots were visually reviewed. Targeted unit tests, TypeScript, e2e build,
  file-size gate and relay compile passed.
- Production/demo and installed native app remain unchanged. This is not a native
  rollout receipt or full just-ci gate. Merge into one reviewed release candidate
  with the existing concurrent widget changes before deployment.

## Current local patch and verification

- Channel cards now use the staff Inbox projection, with channel membership and
  tenant checks. The connector principal, current bound parent name and configured
  Hermes membership come from the server. Titles/search read current bound family
  and representative names; child-name search reads current family children.
- Message rendering keeps signatures/IDs/body unchanged; `/start` is represented
  by a card, meaningful first messages remain visible. Parent authors are scoped
  to the conversation and matching signer. Relay-signed internal routing messages
  get a system label, not a user-profile popover.
- Client mention candidates exclude persona/team catalogs and transport principals.
  They retain channel staff and configured Hermes; server membership overrides a
  stale client membership cache. Routing-save success invalidates channel queries.
- Removed the family storage/audit banner. Duplicate warnings explain manual review
  and link to Clients, without merging records.
- Passed: 39 focused unit tests (37 + 2), desktop typecheck/e2e build, file-size
  guard, relay compile, database test compilation, four existing Inbox E2E and a
  new named-card rendering E2E. Inspected its cropped screenshot visually.
- The earlier first-page limitation and blocked SQL check are resolved by the
  final local follow-up above. Native/live rollout remains a separate gate.

## Implementation notes, 2026-09-09

- Parent booking options previously omitted Core's existing `capacity` and
  `occupied`, exposing only `remaining` and `available`. The projection now
  includes all four, with a regression test for available, full, over-capacity
  and unlimited occurrences. No extra query or family/participant disclosure.
- MCP tool description and Hermes persona now explicitly require a fresh options
  read for occupancy questions, even for unverified contacts. Occupancy includes
  distinct children from applicable active enrollments and pending/confirmed
  reservations. It is not actual attendance or total permanent group enrollment;
  those questions still need a separate authoritative read surface.
- Mention mapping now distinguishes unresolved membership from confirmed absence;
  three mapping tests and desktop typecheck passed. This does not yet resolve
  stale membership, legacy persona discovery, or technical actor presentation.
- The other items below remain open. Do not describe this patch as the complete
  client-thread UX fix or as deployed. Preserve concurrent public-widget changes
  when preparing the unified release.

## Scope confirmed by owner

Follow-up implemented locally: ordinary inbound messages no longer enqueue or
publish repetitive staff-alert messages. Legacy pending alerts are retired in
bounded batches without deleting stored history. Explicit routing/handoff notices
remain. Desktop inbound notifications now reach explicit thread followers and
respect thread/channel mute. 31 notification tests and desktop typecheck pass;
backend check and database test compilation pass. Database integration execution
and live installed-build acceptance remain outstanding.

Replace raw `/start` client roots with readable conversation cards; stop presenting
transport/server principals as unknown people; correct Hermes membership and remove
irrelevant legacy Buzz agent suggestions from AirHop client conversations.

## Implementation order

1. Authoritative conversation projection for channel roots and thread header:
   stable conversation/root IDs, title, provider, bound family/representative,
   handler state and last-message summary. Reuse the Inbox source, tenant and
   channel membership fences; batch-load visible roots, no per-message requests.
   Display a card instead of rewriting signed original messages.
2. Actor presentation: authenticated provider messages display the known parent
   name or “Клиент · Telegram”; relay-authored routing notices display “Система
   AirHop”; Hermes remains Hermes. Resolve via verified principal/receipt data,
   never by trusting arbitrary content or an unsigned label. Do not rename the
   shared connector globally: different parents share the same connector key.
3. Conversation title updates after authoritative identity binding and subsequent
   staff edits. Use confirmed parent/child names for title and search, retaining
   the same thread URL. Unknown contact remains honestly unknown. A phone match
   alone never links a family or exposes its data.
4. Mention candidates in client threads: eligible staff and the configured external
   Hermes principal, not the generic persona catalog, transport principal or relay.
   No hardcoded display-name blacklist: resolve product role and principal IDs.
   Internal agents remain available in their appropriate internal workspaces.
5. Membership correctness: trace useMentions -> candidate.isMember ->
   mapMentionCandidateToSuggestion. Distinguish loading/unknown from confirmed
   absence; refresh scoped membership after routing setup, notifications and
   reconnect. Preserve permission checks; do not merely hide “не в канале”.
6. Service notices: compact non-person message presentation; attention only when
   actual staff intervention is needed, not for every parent message while Hermes
   owns the conversation. Keep real handoff, failure and unanswered-message
   escalation durable and visible. Avoid repeated alerts for the same pending work.
7. Family detail: move technical Booking Core/storage/audit prose to diagnostics.
   A duplicate warning must explain what needs review and provide a safe next
   action; do not auto-merge. The supplied family screenshot predates the reset
   and is evidence of UI design, not evidence that deleted records reappeared.

## Evidence inspected

- client-inbox service and conversation_booking/support.rs already expose/update
  a conversation title, but channel timeline renders the original root message.
- MentionAutocomplete renders notInChannel from candidate.isMember === false.
- Generic quick persona defaults include Fizz, Honey, Bumble. Trace the actual
  useMentions candidate assembly before attributing all observed suggestions to
  that default list.
- Backend service membership was verified during earlier live work; the composer
  still showed Hermes as absent. Cache/projection mismatch remains to reproduce.

## Acceptance gates

- Two distinct parents through one connector: different names/cards, isolated
  histories, no connector rename collision or cross-family leakage.
- New contact -> bound family -> edited parent name: same root and searchable,
  current title in both channel and Inbox.
- Composer opened before/after routing save, reconnect and community switch:
  correct membership and no foreign-community suggestions.
- Client mentions contain no irrelevant built-in personas or transport/server
  accounts; genuine removal of Hermes still displays an accurate unavailable state.
- Parent/AI/system authors cannot be forged with ordinary message text/tags.
- No attention spam during normal Hermes replies; real handoff/failure alerts work.
- Unit tests for projections/candidates; mocked browser E2E and screenshots for
  root/thread/mentions; native installed-build verification. Use build:e2e for mocks.
- Run live acceptance only with owner-provided test messages; no automatic creation
  of new families after the requested clean reset. One reviewed release candidate,
  preserving unrelated widget work and documented release identity.
