# Booking consultation analytics

The Analytics → Consultations tab measures new-booking enquiries handled by Hermes. It is not a count of unique people or a sales funnel for all incoming messages. General information and support for existing bookings stay outside this cohort.

## Evidence and lifecycle

- `airhop_send_parent_reply.consultation` declares `purpose`, the next `waitingFor` question (or null), and optionally `declinedQuote`. The MCP signs one `airhop-consultation` tag on the last parent-facing message. Existing clients may omit it.
- The relay validates metadata inside the existing authenticated reply transaction. No new HTTP endpoint or generic analytics-write capability is added. Source turn, tenant, conversation, agent and lease remain server-owned.
- A question or saved draft starts one open enquiry. Repeated questions, draft revisions, retries and human ownership cycles do not create extra enquiries. A new question after booking/refusal/draft cancellation starts another enquiry. The final reply to the same parent trigger that completed a booking stays on that enquiry.
- Draft saves record first-known activity, time and complete booking details. A delivered confirmation-stage question must exactly equal the server's ready-draft preview. Booking completion is recorded atomically with the booking transaction. A created booking may still await staff confirmation.
- Question counts require provider delivery. Answer counts require subsequent gateway input before enquiry closure. They count distinct enquiries per question category; a response does not mean the necessary field was supplied. Repeated questions can therefore have a previous answer and still currently await another answer.
- `waiting` becomes `quiet` after 48 hours from delivery. Quiet is not refusal. A subsequent parent message removes that state; if no later agent response exists it becomes `agent_waiting`. Human ownership, delivery failures, uninstrumented continuation and actual closure are separate states.
- Refusal is an agent interpretation supported by an exact quote from the current authenticated parent message, not a server interpretation of silence. The report labels this distinction and links to the conversation. Cancelling a draft is a separate outcome.

## Reading the report

`buzz airhop center-analytics --days 7` and the existing Center analytics response include `consultations`. The report has its own `generatedAt`. It selects enquiries by `started_at` using organization-local dates, observes subsequent outcomes through report time, and does not compare unfinished cohorts as if they were mature conversion results.

Staff totals and drilldowns require active non-bot channel membership. The currently registered Analyst and Fizz instead receive organization-wide aggregates with an empty `items` array; other bot roles have no such exception. Registration is checked inside the same read transaction, so replacing the agent key revokes that aggregate access. All joins preserve tenant/organization boundaries. No family/child identifiers, phone numbers or message bodies are added to the report. Conversation titles and exact channel/thread/message identifiers remain subject to the same membership boundary as the inbox.

Totals cover the whole cohort. Detail results are capped at 200, ordered with quiet conversations and delivery failures first. The UI explicitly labels truncation and asks the reader to narrow the period. It never recalculates totals from this subset. The existing channel route rechecks access when opening a conversation.

## Upgrade and rollout

1. Apply additive migrations `0061_airhop_consultation_analytics.sql` and `0062_airhop_consultation_versions.sql` with the matching relay.
2. Deploy the matching `buzz-dev-mcp` and Hermes persona so early questions get typed observations. Existing runtimes continue to work but cannot provide question coverage before draft creation.
3. Build/install the matching Center frontend. An older server shows an unavailable state, not synthetic zeroes. Failure of the consultation query does not take down the existing overview.

There is deliberately no automatic transcript backfill. `untrackedConversations` describes agent conversations without an instrumented enquiry; it can include general information, support and historical dialogues. The full question funnel begins after rollout. No production deployment or outbound parent message is performed by the implementation tests.

## Verification

- Shared type/MCP tests: typed metadata, invalid combinations, one signed observation on the final parent message.
- Isolated PostgreSQL tests: migration, provider delivery, reply/silence transitions, replay deduplication, refusal evidence, exact confirmation summary, separate enquiries after closure, channel revocation, tenant isolation, date-window validation and atomic booking milestones.
- Browser tests: server-contract fixture, stage display, clickable question/status filters, channel/thread/message links, narrow layout, empty/unavailable states and continued overview availability.

Validation notes for this checkout: the broader existing conversation suite has a failure in `conversational_booking_rechecks_price_age_and_last_seat` for its `age` case. The analytics tests and booking milestone assertions pass; age validation is outside this change. Full repository `just test` also depends on the local Docker services.

## Feedback for agent improvement

The default human view shows the booking outcome, observation maturity and the largest count of unanswered questions. Detailed stages, question categories and conversation links are collapsed. Version history is a separate disclosure. This is not an autonomous script editor.

The existing CLI and `airhop_read(resource="center_analytics")` expose the same machine-readable `consultations.learning` contract. No new reporting endpoint is required.

| Field / metric | Definition |
| --- | --- |
| Primary outcome | Booking created no later than seven elapsed days after enquiry start. A booking awaiting staff confirmation is still a created booking. |
| `eligible` | Enquiries started in the selected local-date period for which seven elapsed days have passed, including refusals and cancellations. |
| `booked` | Eligible enquiries meeting the outcome. Always divide by `eligible`, never by all `started` or by the truncated detail list. |
| `pending` | Enquiries still younger than seven days, even when they already have a booking. They enter numerator and denominator together after maturity. A recent seven-day period may therefore have no mature observations; select a longer period. |
| `configuration` | Immutable copy of the active server turn's configured deployment, persona, skills, runtime and model revisions. Captured transactionally when saving a draft or committing a reply; never accepted from model-written tags. |
| `mixed` | More than one configuration participated within the first seven days. These enquiries remain in the overall outcome but are excluded from per-version rates. |
| `unattributed` | Tracking did not cover the start, or no server configuration was available. Historical enquiries are not relabelled on the next reply. |
| Version quality counts | Handoffs, parent-quoted refusals and draft cancellations within seven days, using the same mature cohort. Handoffs do not automatically indicate poor performance. |
| `bookingCancelledNow`, `bookingRejectedNow` | Current status of bookings created within the window. These are explicitly current quality checks, not reconstructed seven-day snapshots. They do not erase the original conversion. |
| `segments` | Mature denominators/numerators by current branch name, provider and whether a family was linked at first exposure. Family linking is not proof of new/existing customer status. Branch assignment is current, not a historical acquisition snapshot. |

The first/last dates on a version are enquiry start dates in this report, **not deployment timestamps**. Up to 20 version groups are returned, with `versionsTruncated` set when needed; overall counts are not capped. A change of desired deployment state never rewrites captured exposures. Only runtime-managed revisions can be measured: editing persona text without updating its declared revision is not detectable here.

### Analyst operating contract

1. Read a fresh report; check availability, scope, period and coverage.
2. State the mature result with numerator and denominator. Use current waiting/delivery states only to locate an investigation, not to infer a lost sale.
3. Compare version configurations and comparable branch/provider/link-status segments. Identify which declared revisions differ; do not invent a script change description from an opaque revision label.
4. Report any conversion difference as observational. Traffic mix, seasonality, manual work and selection can explain it. No statistical significance, causal effect or automatic winner is asserted by this report.
5. Give one evidence-linked hypothesis and a next action, together with quality counts and the sample still pending. For the owner, keep the readout short; retain the numeric evidence in the report.

These changes supply measurement and feedback through the existing Analyst tools. A scheduler, a durable hypothesis/experiment ledger, randomized assignment, automated script editing, deployment and rollback are **not** implemented. Enabling them requires a separate bounded execution mechanism; a read-only metric is not authorization to change prices, consent or booking policy. The report remains useful for evaluating revisions deployed through the existing runtime configuration process.

Additional validation covers frozen versions, replay idempotency, untagged subsequent turns, mixed/unknown exposure, maturity, early/late bookings, registered-agent aggregate access and key revocation. Browser fixtures cover the collapsed owner view and disclosed version evidence. Fixtures are synthetic; no production performance claim is made.
