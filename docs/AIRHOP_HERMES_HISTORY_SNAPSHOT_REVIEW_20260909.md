# Hermes queued-follow-up history fix — 2026-09-09

## Observed failure

Demo logs show two distinct inbound events, not a Telegram redelivery:
the parent's request for the nearest lesson and their follow-up choosing Saturday.
The follow-up arrived at 17:08:22 UTC. The first turn's two replies were published
at 17:08:23 and delivered at 17:08:24, before the follow-up turn acquired its lease
at 17:08:26. The old transcript stopped at the follow-up's receipt time, hiding
both preceding replies. The second turn repeated the lesson details and contact
questions. Both turns completed on attempt 1; each outbound delivery ran once.

## Correction and review

- Keep incoming/internal content bounded by the current input's source receipt.
- Additionally include this conversation's staff/Hermes replies delivered before
  the current lease attempt. Never include later queued parent messages just
  because they arrived before lease acquisition.
- Save a server-owned `historySnapshotAt` in the existing configuration JSON.
  Use `clock_timestamp()` after scope/lease locks, not transaction-start `now()`.
  Refresh it only on acquisition/lease rotation, not context reads or replay.
  Preserve the logical turn's original `started_at` and all capability settings.
- Apply the same delivery cutoff to `internal` labels. A delivery after acquisition
  must not change the transcript during subsequent reads in that attempt.
- Old receipts use `started_at` as a fallback; no new migration or backfill.
- Preserve tenant/channel/current-cycle/ownership/exact-token/expiry checks,
  deleted-content filtering, 40-message and 2,000-character limits. An explicit
  upper receipt bound keeps newer channel traffic outside the history scan.
- Tell Hermes to acknowledge queued clarification without repeating already sent
  conditions or contact questions. The mandatory booking preview and separate
  parent confirmation remain unchanged. Context tests cannot guarantee every
  model wording choice; no content-based message suppression is introduced.

## Regression coverage

The first run against the unchanged implementation reproduced two failures:
queued follow-up lost the delivered reply; retry also lost a newer delivered
reply. The existing-context stability case passed (1 passed, 2 failed).

New PostgreSQL tests exercise queued follow-ups, exclusion of later parent inputs,
delivery after acquisition, same-lease replay, internal labels, retry watermark
refresh with original source/start preservation, stale-token denial and legacy
receipts. The existing CI PostgreSQL test filter includes this module.

Verification against a dedicated local PostgreSQL database:

- All 36 conversation/booking integration tests passed, including all five new
  history regressions (0 failures).
- All 190 database unit tests passed; infrastructure-dependent tests are ignored
  in that unit command and covered separately above where relevant.
- `just test-integration` was attempted but its infrastructure gate failed because
  local Docker is not running. Full repository CI/integration is not claimed.
- Formatting, diff whitespace and guarded deployment shell syntax passed.

Remaining static-check and rollout results are recorded after execution below.

## Release boundary

Isolated branch: `codex/hermes-history-snapshot`, based on the previous deployed
runtime-recovery release `da09388809b1` and its review documentation. Concurrent
main-worktree changes are not included. Guarded scripts now pin that exact demo
baseline and append its compose override. Production, the Telegram gateway,
public frontend, booking controls and schema 55 are outside this change.

The operator approved removal of unused Docker build cache older than 24 hours.
`docker builder prune --filter until=24h` reclaimed 162 MB; the same age-filtered
cleanup with `--all` reclaimed another 23.56 GB of unused build cache, leaving
approximately 26 GiB free. No release image,
container, volume, database or backup was removed; discarded cache can be rebuilt.
