# Interactive Welcome — implementation checkpoint

Approved behavior is recorded in AIRHOP_SOURCE_OF_TRUTH.md (2026-09-10 amendment).
This file records implementation status, not a release claim.

## Current checkpoint (supersedes the chronological notes below)

- Service-author change: relay-signed AirHop messages now ensure a signed kind:0
  AirHop Center profile, without impersonating an agent. Focused relay test
  31633 and desktop type check 45087 passed. Native 14794 failed BEFORE Fizz's
  first introduction due to repeated DeepSeek transport errors (20:22–20:23),
  not the profile assertion. Queue retained/retried the kickoff. API reachability
  subsequently recovered (unauthenticated /v1/models returned HTTP 401, TLS
  completed in 0.111s). Corrected native profile assertion to raw IPC display_name.
  No demo/Mac update or reset has happened yet.
- Final live retry 86435 PASSED both native phases and persisted SQL assertions
  with real DeepSeek for all four internal agents (guest remains deterministic
  in this isolated harness). Verified ordinary question during introductions,
  five introductions, concrete first question, read-only inventory, skip/pause,
  full restart, remembered teacher step, typed branch preview and owner ✅ commit.
  Log: `/private/tmp/airhop-welcome-0511-delivery-guard.log`.
  Source candidate is 0.5.11; demo/Mac remain 0.5.10. Still required: service
  preview-author presentation, unified frozen release/build/deployment, scoped
  Welcome reset with backup and populated demo/real Telegram acceptance. This
  passing isolated run is not a release or a complete goal receipt.
- Live 5785 first phase PASSED with the concrete first setup question, but
  restart phase FAILED: DeepSeek read data and returned ordinary final text
  without calling airhop_send_messages (19:56:58); invisible to the owner.
  Added a product-tool-scoped reply guard: bounded reminders, successful tool
  result required for this round, reset on accepted steering, explicit error
  rather than false success if no delivery. Red regression 91858 reproduced it;
  full buzz-agent tests + Clippy 71578 passed; both bounded-error and recovery
  tests 86885 passed after limiting successful-result lookup to current calls.
  Live repeat 86435 subsequently PASSED; see the checkpoint above.
- Native 63973 PASSED both live DeepSeek phases and database assertions:
  mid-intro owner question answered before setup, five introductions, pause,
  restart/skip memory, exact branch preview and owner reaction commit. Inspected
  live-initial/restored screenshots. Visual/content review found that the first
  setup stage only listed data without a question; added tool validation and a
  native assertion requiring an actual question plus expects_reply=true. MCP
  airhop tests 67182 and all 12 kickoff tests pass; Biome/TypeScript pass.
  New live run: `/private/tmp/airhop-welcome-0511-question-guard.log`.
  Separate remaining presentation issue: relay-signed action preview author is
  a technical public key. Needs an authoritative service profile, not an inferred
  or forged Administrator identity. Demo/Mac still 0.5.10; no reset performed.
- Retry 4056 exposed a real lost-message race: the native owner question landed
  during Fizz's final model response; ACP acknowledged a non-cancelling steer,
  but buzz-agent returned end_turn without draining that accepted input. Welcome
  correctly waited for an acknowledgement that never came. New gated fake-LLM
  regression failed before the fix (56491) and passed afterward. Normal end_turn
  now closes steer admission and processes already accepted input before exiting;
  later racing sends fail, allowing the harness to retain them instead of dropping
  an acknowledged message. Both tool-call and final-text race variants and all
  19 fake-LLM integration tests pass (50039 and strengthened 24527 test phase).
  Agent Clippy 24527 PASSED. Full buzz-agent package tests 37935 PASSED after
  updating the stale persona fixture loader for include_str Markdown prompts
  and the agreed isolated Hermes/typed-confirmation contracts. Full CI below
  predates this narrow agent fix. Native 0.5.11 interruption + setup acceptance
  63973 PASSED: `/private/tmp/airhop-welcome-0511-steer-fixed.log`.
- Full `just ci` 19387 PASSED (exit 0), including 4552 desktop JS tests,
  native tests, web build and 1138 mobile tests (one mobile test skipped).
  All four desktop version files then advanced together to 0.5.11; release
  version validation and all 24 release-identity tests passed (37341).
- Run 54199 failed the interruption ordering assertion because native WebDriver
  typing sent the question at 19:28:15, after setup started at 19:27:58. This is
  not evidence about mid-intro interruption. The timing-sensitive probe now uses
  the same signed native send command as the composer; all ordinary probes still
  use UI typing. It also asserts the question really precedes the guest intro.
  Biome/TypeScript passed (83030). Retry 4056 exposed the race described above.
  Inspect the new live-initial and live-restored screenshots only after the
  corrected native run succeeds.
- Rechecked 3309 source files from deployed 0.5.10: none missing locally.
  Demo still uses `airhub-center-relay:airhop-center-0.5.10-ca857b59108e`, image
  `sha256:66e473d4a470d57479e172bfbbbe9801f72270e8b5e42547f4b2e9243bb48c7b`.
  No new commit, artifact candidate, deployment or reset yet.
- Standalone live DeepSeek run 80931 PASSED (exit 0), log:
  `/private/tmp/airhop-welcome-native-live-standalone.log`. Fresh native activation,
  five introductions + first question, fresh settings read, unmentioned replies,
  branch skip, pause, full app restart and resume without a reminder all passed.
  Administrator published the exact branch name/address preview; the probe
  asserted zero branches before the owner's native ✅ reaction and one afterward.
  Final SQL asserted one committed action and guest receipt, no guest membership.
  This does not prove populated-org completion, mid-intro interruption, real
  Telegram, the final release binary or current live screenshots. No release or
  reset has occurred. The earlier startup timeout did not reproduce without CI.
- Migration inventory follow-up 69309 PASSED after asserting migration 64.
- Full CI retry 19387 is running (`/private/tmp/airhop-welcome-ci-final.log`),
  now past workspace unit tests into desktop tests. Do not start native alongside
  it. Added opt-in AIRHOP_E2E_INTERRUPT_PROBE=1 to the live probe: ask a short
  unmentioned question before the first setup question, require an acknowledged
  reply before setup, then run the existing exact-once/restart/confirmation flow.
  This new probe has NOT run. Native spec now saves separate live-initial and
  live-restored screenshots after probes, instead of relying on pre-dialog shots.
  Biome passed; TypeScript session 43305 is pending. Next: finish CI, then run
  native alone with both SETUP_PROBE=1 and INTERRUPT_PROBE=1 and inspect the new
  screenshots. Source/app/demo have not been released or reset.
- User explicitly approved live DeepSeek testing. There is no provider-approval
  blocker. Demo and installed Mac remain 0.5.10; no reset or new release yet.
- Live baseline passed introductions, unmentioned replies, skip/pause and full
  restart. A subsequent run resumed at teachers without reminding Fizz about the
  skipped branches, but failed to produce a typed branch preview.
- Branch input now has a typed schema, defaults unknown working hours to empty,
  and reports deserialization details. Administrator instructions require the
  original owner event, visible preview/error, and the actual ✅ confirmation.
- Extended run 22694 failed before setup: all five introductions persisted but
  Fizz's first question was never dispatched. Content Marketer recovered from
  malformed DeepSeek tool JSON via the existing queue retry. The guest receipt
  existed in server history; that is not evidence of successful live UI delivery.
- Welcome now periodically reconciles durable history until setup starts, and
  stops only on a stage receipt authored by registered Fizz. Run 27201 passed
  introductions, the first setup question and a fresh-data owner answer, then
  failed on DeepSeek transport errors (multiple retries). It did not reach the
  confirmation probe. Direct no-credential availability checks subsequently
  reached DeepSeek (401) and pub.dev (200). Retry 31644 failed before any model
  turn: four runtimes remained starting for the 30-second readiness timeout;
  logs contain only process start/stop markers. Full CI was compiling heavily
  concurrently. Do not infer the cause or weaken the assertion: retry native
  alone after CI finishes, and inspect live processes if startup stalls again.
- Full CI 28978 failed only after reaching the desktop file-size gate. Extracted
  helpers instead of increasing limits; focused size/Biome/TypeScript checks
  passed. Full CI rerun 63117 reached mobile-check but failed resolving pub.dev
  (exit 69), not a source assertion. Network retry 12608 passed dependency
  resolution and reached unit tests. The buzz-db migration inventory test failed
  because it still expected 63 migrations. Updated it to assert 64 and the exact
  new kickoff trigger; focused rerun pending after the active CI process exits.
  The runner is continuing the remaining crates, so do not restart it early.
- Focused welcomeKickoff/welcomeGuide unit tests passed (52314); TypeScript and
  Biome passed after reconciliation changes (10313). Current source is not
  frozen or released. Do not run another native test while full CI is active.

## Chronological evidence (includes resolved failures and superseded statuses)

## Verified locally

- Native Tauri flow PASSED with current bundled sidecars: first-owner activation,
  five introductions (Hermes from the separate ACP host), unmentioned owner
  message, Fizz reply, reload with exactly one of each introduction, no thread.
  SQL assertions confirmed one guest receipt, no guest membership, no p-tag on
  the owner message, and exactly one Fizz acknowledgement. Deterministic provider
  proves delivery/protocol only, not fresh-data reasoning or real model quality.
  Native debug builds now prefer bundled binaries under the `wdio` feature;
  otherwise old workspace debug binaries silently won despite fresh bundles.
  Visual inspection of /private/tmp/airhop-welcome-native-restored.png exposed
  same-second replay ordering and the obsolete @ hint. Those are now corrected
  locally (paced stages, guest after predecessor, no-mention prompt) and a
  stricter ordered-replay native run PASSED. Log:
  /private/tmp/airhop-welcome-native-current.log. A follow-up now launches two
  separate WDIO/application processes, preserving only the isolated test profile
  between them, and checks a fresh unmentioned response after full restart.
  That restart test FAILED: history restored but runtime list stayed empty.
  Root cause: Welcome creation correctly starts dormant before registration, but
  never enabled startOnAppLaunch after registration. welcomeGuide.ts now uses
  setManagedAgentStartOnAppLaunch only after membership and registration succeed.
  TypeScript and 16 Welcome guide unit tests pass. The repeat native run PASSED:
  /private/tmp/airhop-welcome-native-restart-fixed.log. Two distinct application
  sessions restored the same identity/history, started all four internal agents,
  returned a fresh unmentioned reply after restart and left one guest receipt
  with no private-channel membership. SQL verified each owner probe's exact Fizz
  acknowledgement. The provider remains deterministic, so this does not prove
  live-model setup decisions or pause/skip behavior.
  Screenshot review still exposed a same-second answer before its owner question
  and the guest's shortened key instead of a profile name. These are remaining
  UI acceptance issues, despite the intro-order assertions passing.
  Follow-up edits: MCP now resolves response source events in the current channel
  and waits for a strictly later timestamp before sending; multiple response
  parts get distinct timestamps. Missing/foreign sources and excessive clock
  skew fail closed. Unit checks cover same-second, old, missing and foreign
  sources. Welcome also supplies a profile fallback only for the control-plane
  registered guest key; real names and avatars take precedence. A native test now
  explicitly checks answer-after-question and the Hermes portrait after replay.
  These follow-up edits are not yet native-verified. TypeScript and both guest
  profile unit tests passed. Both Rust response-order/receipt tests passed;
  deprecated timestamp accessors were then replaced with as_secs. Native causal
  ordering/profile attempt 13981 did not reach the test: editing its shell file
  during execution caused an EOF parse error. It is terminal, not a PASS.
  Current script passes bash -n; frozen-during-run retry 46454 PASSED (exit 0),
  /private/tmp/airhop-welcome-native-causal-retry.log. Screenshot visually verifies
  Hermes name/portrait and response-after-question. Both initial and full-restart
  runs passed, as did the persisted SQL receipt and guest isolation assertions.
  Live-provider opt-in was added to the harness with AIRHOP_E2E_PROVIDER_CONFIG:
  it reads the existing provider config without logging credentials, writes only
  the isolated E2E profile with mode 0600, and runs welcomeLiveProbe.ts instead of
  exact fake-model text assertions. Probes read setup, skip branches, pause and
  resume to teachers after a process restart; SQL checks no setup mutations.
  This live mode has NOT run yet. The execution request was rejected by automatic
  review because sending organization context to the external provider requires
  explicit approval. No retry or alternate execution was attempted. The harness
  uses a freshly reset buzz-harness database, a synthetic AirHop E2E Center and
  an isolated app profile; it does not clone demo/organization knowledge.
  Asking for permission to send that synthetic context via the existing DeepSeek
  account. This is the first approval-blocked turn, not grounds to block the goal.
  The live probe does not cover preview/confirmation or the
  real Telegram experiment. TypeScript verification passed (session 68954,
  exit 0); the six native-runner/fake-provider unit checks also passed.
  Installed Mac independently rechecked: 0.5.10 / ca857b59108e, unchanged.
  Real provider readiness check succeeded (HTTP 200): configured deepseek-chat
  at api.deepseek.com/v1 replied OK and reported model deepseek-flash, 10 tokens.
  No organization data was sent; credentials were neither printed nor changed.
  This only proves provider connectivity, not the Welcome conversation.

## Current verification after DeepSeek approval

Latest setup follow-up 96065 FAILED: memory without a reminder passed (Fizz
remembered skipped branches and resumed at teachers), delegation reached the
Administrator and airhop_prepare_action ran, but no pending action/preview was
created. No branch was written. The MCP CreateBranch input was opaque Value
while the relay requires workingHours. It now has explicit PrepareBranchInput
and defaults unknown hours to an empty map. Unit 10424 PASSED. Relay parse errors
now include the missing/invalid field instead of only generic invalid JSON.
Administrator instructions now require the original human source ID, visible
failure reporting, and ✅ confirmation; Fizz also names ✅ rather than plain
confirmation text. Exact legacy Administrator prompt migration preserves edits.
The specific original rejected payload was not recorded, so the schema gap is
a confirmed defect but its causal sufficiency still needs the repeated test.

Full CI 28978 FAILED at the desktop file-size ratchet after workspace Clippy
passed. Helpers were extracted into discovery/search_dirs.rs,
migration/builtin_avatars.rs and EmptyMessageDeleteDialog.tsx; no limit increase.
Desktop file-size check + TypeScript 28669 PASSED, formatting 29067/18746 passed.
These new fixes mean full CI must be repeated before release. Native setup retry
22694 is running: /private/tmp/airhop-welcome-native-live-setup-fixed.log.
Harness/tests/source are frozen during this run. Its runner now builds
buzz-admin and buzz-relay together before --prebuilt preparation, avoiding
feature/toolchain thrashing. Shell syntax and runner unit checks passed.

Live run 10965 PASSED (exit 0), including initial scenario, full process restart
and final SQL no-mutation/guest-isolation checks. Log:
/private/tmp/airhop-welcome-native-live-throttled.log. DeepSeek acknowledged
skipping branches, advanced to teachers and paused. The restart question still
reminded it about branches; follow-up 96065 removes that hint and adds a real
typed branch preview, proves no branch before owner ✅, then checks one committed
branch/action. Log: /private/tmp/airhop-welcome-native-live-setup.log. This run
is active, not a PASS; no production data is used or changed. TypeScript 34190
passed after these test additions.

Read-only cleanup inventory: local managed-agents.json contains exactly the
four registered product identities for demo, all start_on_app_launch=true.
Legacy Fizz/Honey/Bumble identities belong to buzz.srv1610606.hstgr.cloud, not
demo. HQ product identities belong to hq.airhop.ru. Preserve these other-relay
identities; do not delete them as if they were demo leftovers. Placeholder rows
with empty pubkeys also are not evidence of live demo bots. The demo users
agent_type query returned no rows; that column is not a sufficient inventory.

Live run 44138 FAILED (exit 1): DeepSeek sent content_marketer_intro twice, and
the exact-once assertion caught it before skip/pause probes. Five roles otherwise
introduced themselves; Fizz read fresh synthetic settings and asked about
branches. Evidence: /private/tmp/airhop-welcome-native-live.log and
/private/tmp/airhop-welcome-live-initial.json. The existing internal kickoff
receipt table had no publication enforcement. Migration 0064 now backfills the
first valid receipt without deleting history and atomically rejects a second
event for that stage; it validates the registered role key. MCP returns the
existing event for a retry, including the concurrent-write race. The isolated
SQL regression scripts/test-airhop-welcome-kickoff-publication.sql PASSED and
rolled back all test mutations. cargo check session 58408 PASSED. Retry 59872
is running, log /private/tmp/airhop-welcome-native-live-idempotent.log; do not
edit its executing harness/tests. This is not a passing live test or a release.

Update: 59872 exited 1. All five role introductions appeared once, but the
live probe repeatedly called get_channels plus history every second and hit
the application's relay rate limit, then WebDriver timeouts before the first
setup question. Do not count this as acceptance. No manual process kill was
needed: the runner exited itself. The test now caches its channel ID, polls
every five seconds, checks all stage counts from one snapshot, and writes the
last successful snapshot on failure instead of masking errors with another
network read. TypeScript PASSED (53796). Third live run 10965 is running:
/private/tmp/airhop-welcome-native-live-throttled.log. Harness/tests are frozen
while it runs. Server rate limits were not disabled or increased.

The user explicitly approved: «тестируй с дипсик, нет проблем». Both live runs
use synthetic data only. Do not edit the executing harness or test files. Full
desktop JS suite session 45658 PASSED: 4552 tests, zero failures or skips
(/private/tmp/airhop-welcome-desktop-final-tests.log). All-target MCP Clippy
session 55755 PASSED with warnings denied
(/private/tmp/airhop-welcome-mcp-final-clippy.log).
An eight-second timeout now bounds the causal
timestamp wait if the local clock moves backwards; this last small server edit
is newer than the successful native run and needs validation before freezing.
- Avatar migration regression passed: exact old seeded upload updates while a
  custom avatar remains unchanged, and a repeated migration is a no-op.

- Parallel task «Упростить раздел аналитики» has now shipped 0.5.10,
  ca857b59108e42383957d7955e61dea53e6b2116, to demo and Mac. Installed Mac
  Info.plist confirms 0.5.10; its deployment receipt is referenced by
  /tmp/consultation-release-state.json. Next release must use that baseline,
  not the stale 0.5.9 server image. All consultation files match that commit;
  differences in the three shared Rust files are only Welcome additions.
- Native test exposed stale sidecars: the prior harness rebuilt only the Tauri
  shell and reused old agent executables, so no guest polling occurred. Harness
  now builds and bundles all four sidecars just like the release builder.
  The separate guest ACP process uses an explicit fake provider for startup;
  the guest introduction itself still does not use a model. Repeat acceptance
  is required; the earlier four-intro native run is not a passing result.
- Native provisioning also exposed shared legacy Honey artwork for Administrator
  and Content Marketer. Product avatar generation now embeds the same four PNGs
  as the frontend; distinct-artwork unit test passes. Exact legacy avatar hashes
  are registered for upgrade without replacing customized images.

- Guest waiting no longer has to be invisible: the channel header now shows a
  localized connection notice and retry control after the fourth introduction,
  while deployment state refreshes every ten seconds. It distinguishes pending
  lookup, failed lookup, absent deployment, disabled/paused deployment and pending
  guest receipt. It does not send chat messages or bypass guest eligibility.
  TypeScript, 15 kickoff/history tests and the four-locale notice-rendering test
  pass. Native visual and reconnect acceptance still need running.

- Real local relay guest test now passes (`scripts/test-airhop-welcome-guest-live.mjs`):
  an hour-old predecessor receives a fresh invitation, concurrent signed sends
  and replay persist exactly one intro with its transactional receipt, arbitrary
  and threaded writes are rejected while the invitation is still open, and the
  parent identity cannot read private history or acquire channel membership.
  This uses only `buzz-harness` fixtures and does not prove the full native flow.
  The test checks relay availability before inserting fixtures and sends query
  filters as an array, matching the actual bridge contract.
  Migration 0063 reserves the invitation timestamp and claims publication in the
  event transaction. It replaces the old predecessor+1 timestamp, which failed
  the database's replica fence after a delayed introduction. Normal timestamp
  validation remains enabled.

- Latest full `just ci` completed with exit 0, log
  /private/tmp/airhop-welcome-current-ci.log: 4549 desktop JS tests passed;
  mobile 1138 passed, one skipped. This is a moving-worktree check, not a frozen
  candidate identity check. The parallel analytics task is still active.
- Fizz's product prompt now contains the actual ordered Welcome flow, fresh-data
  checks, explicit confirmation, interruptions, skipping and a practical final
  test. Exact-match migration from both prior stock prompts is unit-tested and
  preserves customized instructions. The user briefly suggested a free-form
  conversation but then explicitly clarified that Welcome should keep the
  ordered onboarding; this order is scoped to Welcome, not all agent channels.
- Docker has been started. Only buzz-harness test schemas were reset;
  no live demo data was changed. Native harness
  still needs updating for the isolated fifth guest and current product avatars
  before its old assertions can serve as acceptance evidence.

- Follow-up verification: production guest eligibility SQL executed against the
  isolated `buzz_center_059_2cb9fc1b3923_preflight` database in a transaction that
  ended with ROLLBACK. Current guest accepted; foreign tenant/key, disabled/paused
  deployment, archived Welcome and pending owner question rejected. A kickoff
  message cannot masquerade as a response acknowledgement; a real response
  resumes eligibility. Reproducible generator: scripts/test-airhop-welcome-guest-db.mjs.
- Three real HTTP-loopback ACP guest tests pass: exact signed envelope, no repeat
  after acceptance, retry after rejection, deterministic identity after restart,
  and no publication for null/foreign/expanded invitations. These are not a live
  relay-ingestion acceptance test; that remains a release gate.
- Retired automatic public `welcome-everyone` creation in native starter channels;
  existing public history remains readable without onboarding controls. Updated
  mock to match native behavior. Twelve Welcome unit tests, native regression,
  TypeScript and two member-startup Playwright scenarios pass. Dedicated fresh
  owner Playwright scenario also passes: one private Welcome, no public duplicate.
  Owner fixture explicitly supplies the four AirHop personas and mocks team
  registration at the network boundary; default legacy Buzz fixtures are not
  proof of product provisioning. Log: /private/tmp/airhop-welcome-owner-e2e.log.
- ACP/DB/relay all-target Clippy passed after guest wiring, including the new
  HTTP tests. Log: /private/tmp/airhop-welcome-guest-clippy.log.
- Fifteen kickoff/history unit tests pass with the project's test loader. A bare
  node invocation failed module alias resolution; the supported loader succeeds.
  First-question async dispatch also rechecks the registered Hermes receipt.

- Cold history gating was committed in becca59b, not yet deployed.
- Welcome-scoped no-mention relay subscriptions and local filter exception:
  698 buzz-acp unit tests passed, including ordinary-channel, disabled-gate,
  dynamic subscription and explicit channel allowlist regressions.
- First-question task now requests fresh organization settings, schedule and
  knowledge, distinguishes failed reads from empty data, asks about one missing
  topic, offers skipping and requires confirmed changes.

## Remaining release gates

Guest implementation in progress: buzz-core/src/welcome_guest.rs defines the
closed signed introduction envelope (locale, channel, registered guest key,
predecessor receipt ID, stable timestamp). Two tests and core Clippy pass.
buzz-db/src/airhop/welcome_guest.rs derives eligibility from active organization,
current enabled/unpaused deployment, live Welcome channel and four signed role
receipts. DB cargo check passes; SQL integration coverage is still required.
GET welcome-team now returns only guestInvitation to the current parent key.
Wiring now implemented locally: parent runtime polls every ten seconds with a
three-second timeout and signs this envelope without invoking its model/tools;
ingestion revalidates the exact envelope before narrowly allowing this
nonmember write; frontend waits for the guest stage from the registered parent
key before setup. ACP and relay cargo check passed, twelve kickoff tests and
TypeScript passed. Guest SQL additionally waits for all owner questions to have
explicit registered-agent response references. This is not live acceptance.
Do not grant Hermes ordinary Welcome membership or loosen generic write guards.
Reply created_at now comes from the durable invitation in migration 0063;
the old predecessor+1 design was rejected by live testing. Parent interruption and
tenant/deployment rotation must be integration-tested, not inferred from unit
tests. Latest relay compile log: /private/tmp/airhop-guest-relay-check.log.
Latest combined compile log: /private/tmp/airhop-guest-wiring-check.log.
Local Docker and the isolated relay are now available for integration testing.

Latest local addition: welcomeHistory.ts reads the channel through composite
keyset pages independently of the visible timeline. Replay stops on abort,
repeated cursor or the bounded page limit; incomplete reads never start intro.
Its three unit tests, eleven kickoff tests and TypeScript passed. No application
update or server deployment has been performed for these changes.
The old-response migration remains unresolved: pre-protocol agent replies lack
airhop-responds-to tags, so a raw scan of all owner messages can pause a legacy
Welcome indefinitely. Do not ship this gate until that compatibility path and
the isolated Hermes guest stage are verified.

2026-09-10 follow-up: user approved combining today's UI work from task
«Исправить иконку профиля» and the public booking widget branch. The booking
feature commit 1767f41d applies empty against HEAD (content already present);
the missing close-button reproduction script 2d9576e3 was applied without a
commit and is staged. Do not duplicate surname changes (patch-equivalent).

Implemented locally: optional respondsTo IDs on airhop_send_messages, emitted
only on the final response as flat airhop-responds-to tags; kickoff rejects such
references. Desktop pauses for unacknowledged owner messages and rechecks after
async context loading. This still needs live and historical-window acceptance:
older responses have no acknowledgement tags, and the timeline is paginated.
Do not claim the resume gate is production-ready until those cases are handled.

Combined CI log: /private/tmp/airhop-unified-20260910-ci.log. Rust clippy passed;
desktop suite found one locale wording assertion, now fixed and verified with
16 focused Welcome tests. Full CI must be rerun on the final frozen candidate.

- Persisted onboarding progress: distinguish pending owner question from answered
  turn; pause introductions until that exact question is handled, then resume.
  A later timestamp alone is not evidence of a completed answer. Handle replay,
  multiple owner messages, reconnect, history pagination and concurrent clients.
- Five short introductions including Hermes's isolated guest stage under his own
  key. Never impersonate Hermes using the internal Administrator or grant the
  parent runtime general Welcome access.
- Walk through missing setup topics in approved order, persist skips, preview
  changes through existing typed actions and require explicit confirmation.
- Remove redundant product entry to welcome-everyone without deleting historical
  conversations. Verify Welcome layout together with parallel UI changes.
- End-to-end live test: plain message, interruption, resume, restart, existing
  organization, blank setup, unavailable provider, and Telegram practical test.
- Build and deploy one verified candidate to demo and Mac; retain account/key,
  organization and knowledge base. Last verified installed candidate is 0.5.10;
  the Welcome changes here are not installed yet.

Parallel UI edits in the working tree are not part of this checkpoint's authored
changes and must be reconciled, not overwritten or silently staged.

## Latest acceptance — 2026-09-10

The unified 0.5.11 candidate at 9aede01c1f9c includes the approved parallel UI
and public-form changes, but is superseded by the response-reference fix below.
Live testing found that optional `respondsTo` let a real answer publish without
acknowledging its owner question; the kickoff gate then correctly kept waiting.
Normal Welcome messages now require nonempty exact source IDs before publication;
kickoff messages remain exempt and cannot carry response references. A corrective
tool error lets the agent retry without publishing an unlinked answer.
The regression test failed before the fix and passed after it.

Native run `/private/tmp/airhop-welcome-0511-receipt-fix.log` passed initial start,
mid-intro interruption, minimized-window introductions, normal owner dialogue,
skip to teachers, pause, full process restart, and confirmed branch creation.
The final SQL assertions passed, including isolated Hermes access and no branch
creation before confirmation. Internal agents used real DeepSeek; the isolated
guest introduction used the deterministic test provider. Only synthetic data
was used. Temporary production-hook diagnostics were removed after this run.

Still required: rebuild and verify the final candidate; authorized demo/Mac
rollout with backups and scoped Welcome reset; populated-organization and real
Telegram acceptance. Legacy unlinked history is not claimed repaired: the agreed
reset must create a new Welcome ID while retaining organization and account data.
