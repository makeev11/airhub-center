# Hermes dialogue and latency repair, 2026-09-11

Status: deployed to test Hygge on 2026-09-11; technical postflight passed.
Real model/Telegram dialogue acceptance remains unmeasured after deployment.
Baseline: `daf769533b05`, demo runtime and relay `0.5.12`.

## Observed incident

Read-only inspection of the Hygge test conversation on `demo.airhop.ru`,
2026-09-11 00:22–00:31 UTC, established:

- 15 parent inputs, 22 outbound messages, all delivered on the first attempt.
- Five booking-summary messages, including repeated corrected summaries.
- Four `Hermes ended without committing a parent reply` failures, each followed
  by batch retry and process respawn.
- Later input-to-reply times of 91–115 seconds. Confirmation took 102 seconds.
- Individual observed model calls took roughly 2–24 seconds. The final model
  request contained 79,165 input tokens after accumulated session history.
- An attempted booking commit while processing a surname correction was
  rejected. The subsequent confirmation produced one confirmed booking.

These are separate logical replies, not Telegram delivery retries. There was no
configured human-like delay responsible for the long pauses. Queueing, model
work and recovery account for the observed latency; these measurements do not
predict post-deployment response times.

## Changes

1. The authenticated claim advertises whether the conversation is threaded.
   Pending messages in a known legacy flat conversation can form one batch.
   Unknown/shared channels keep the existing thread isolation, and the server
   checks every batch's scope. A reconnect cannot replay completed input under
   a new batch ID. Explicit retries of an existing failed lease retain their
   original source and history-snapshot semantics.
2. Parent prompts no longer fetch generic Buzz history or include raw queue
   text, slash commands, core memory or channel canvas. Each turn starts a fresh
   ACP session and reads the bounded server snapshot and persisted booking draft.
   The current source is identified by `conversation.sourceMessageId`, rather
   than the last visible history entry. This removes a second, potentially newer
   history source and prevents unlimited accumulation of old tool results.
3. After a normal ACP end, the supervisor checks the exact lease on the existing
   finish endpoint using `status: check`. If a reply is still required, one
   corrective prompt runs in the same session and lease, within the original
   deadline. Completed output and legitimate silent staff resumes are excluded.
   Remaining missing-send failures use the bounded retry path without declaring
   the healthy ACP transport broken or respawning it.
4. Instructions distinguish surname/date corrections from booking consent and
   favor one combined response addressing the parent's current question. Logs
   now record queue waiting time and coalesced event count for acceptance checks.

## Verification and rollout

Follow-up: the initial context used to load a complete staff family projection
both during authorization and again to return only names. Authorization now
checks the exact active binding with `EXISTS`; the initial context uses a small
family projection with active child names and at most three relevant bookings.
Unlinked contacts skip both the family projection and booking lookup. The
persona and tool descriptions require a concrete missing fact before expanding
family history, querying booking options or searching knowledge. Existing
bookings no longer cause an unsolicited repeated confirmation on every message.
This is a local implementation change; it does not establish that the live
model follows the intended minimal tool path until acceptance testing.

The earlier full `just test` run completed successfully. Follow-up coverage
checks active binding, tenant isolation, bounded history, focus/upcoming booking
priority and exclusion of staff-only fields from the small projection.

Follow-up verification passed: 4 family projection tests (including dedicated
Postgres scenarios), 10 relay backend tests, 18 MCP tests, formatting and Clippy
for DB/relay/MCP with warnings denied. Full `just test` passed on retry. Its first
attempt hit two timing-sensitive `buzz-agent/tests/fake_llm.rs` steer tests:
their receive loops stop if the prompt completes before the steer response.
The unchanged file passed all 19 tests separately, and the complete retry also
passed. No unrelated agent code or tests were changed for that retry.

The subsequent executable dialogue graph adds lease-scoped tool states, bounded
read/write attempts, compact repeated-read references, receipt reuse for
successful mutations, and one ordinary reply per turn. Only the exact booking
preview permits a second message. Confirmation can commit and send its confirmed
outcome in one MCP call; pending/review outcomes never use that confirmation
text. A delivery retry after commit reuses the booking receipt. The queue waits
for 1.2 seconds of quiet, capped at three seconds, while exact confirmations
bypass this delay. A dedicated 250ms timer avoids the 30-second maintenance
wait. Unknown/shared threads remain isolated. These checks preceded the
test Hygge rollout recorded below.

Graph verification passed: all 706 ACP library tests, all 122 MCP library tests,
the full `just test` run, formatting, and Clippy for ACP/MCP with warnings denied.
The mock-HTTP scenarios check confirmed-only combined delivery, pending/review
suppression, signed output, duplicate-send suppression and retrying failed
delivery without another booking command. No real parent messages were sent.

Follow-up requested pacing: subsequent ordinary replies now have a 2/3/4-second
minimum total interval by reply length, measured from server-recorded parent
input. Queue/model time is included, not added again. First replies, exact
confirmations, recovery and handoff bypass this pause. Only delivered external
replies establish continuation. Timing survives context refreshes, resets per
grant, and rechecks the grant before publishing. All 29 targeted MCP tests and
Clippy passed, including a timed mock-HTTP send, elapsed-work accounting, fast
exceptions and lease reset. These checks preceded the rollout recorded below.

Regression coverage includes flat-chat batching, isolation of shared threads,
an actual local ACP pipe ending without a tool send, at most one corrective
prompt, omission of raw queued slash commands, checked delivery, tenant and lease
boundaries, silent staff resume, replay under changed batch IDs, surname/date
corrections without consent, booking atomicity and the original history tests.

The isolated PostgreSQL suite exposed an older test still treating group age
ranges as hard restrictions. Current Booking Core explicitly treats them as
recommendations; the test now asserts that existing behavior while retaining
the price-change and last-seat rejection checks. No age policy was changed.

Deploy the matching relay first, then the parent runtime. No database migration
or Telegram gateway change is required. Existing accounts and conversation data
are preserved. Before declaring the issue resolved in the live test account,
repeat a parent-written burst of name/surname/date messages, a surname correction
and confirmation; check reply count, queue delay, actual Telegram delivery and
the single booking receipt. No external test messages or bookings were created.

## Test Hygge deployment

The user authorized publication. Release `airhop-center-0.5.12-00489edf8334`
was deployed to the existing `buzz-demo` project on 2026-09-11 at approximately
01:48 UTC, from signed commit `00489edf8334ce7c78c07aeb633b89e3afc90a43`.
Only the demo relay and Hermes runtime were replaced, relay first. The production
relay, public website, Telegram gateway and other neighboring containers retained
their container identities and start times. The existing public frontend files
passed byte-for-byte checksum verification before and after deployment.

The database backup was restored to an isolated preflight database, where the
new administrative binary verified the existing migrations. The temporary
database was removed afterward. Live migration version remains 64; no live
migrations were run. A final database dump and runtime-volume backup were taken
before switching. Organization configuration, knowledge data and agent business
controls passed before/after comparisons. Backups and rollback configuration are
retained on the deployment host:

- Backup: `/opt/airhop/backups/demo-before-hermes-dialogue-00489edf8334`
- Release and rollback: `/opt/airhop/hermes-dialogue-00489edf8334`
- Source archive SHA-256: `bf5c4186bde6e310860138ac2ed2cf93299f179a3e0a41f8dc3e584f7a04f1a8`
- Relay image: `sha256:871fe00007f5eccb4c597adef4ffbba4453bef8f311e83a20dbf4e1e8fe69a82`
- Hermes image: `sha256:89c7f0537bc122b70da43644c4ce7753c4958a8318979d44513e11321284f2bb`

Image and live MCP checks passed: ten directly visible tools, the optional
`confirmedReply` parameter, disabled generic memory and the upstream tool-search
negative control. Health and public catalog requests succeeded. Both containers
were healthy with zero restarts and zero error-level startup lines. Hermes
connected to the relay and subscribed to two channels; no active turns or pending
external messages were present at postflight. No real parent/model test was
triggered, so response latency, token savings and conversion uplift have not yet
been measured on this deployed version.
