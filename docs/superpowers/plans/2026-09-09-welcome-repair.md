# Welcome repair — active goal

Acceptance: all four registered staff agents introduce themselves in order; an
owner greeting does not abort introductions and receives a response; reloads do
not duplicate stages. Verify this in the installed app, not only mock tests.

Evidence from demo 0.5.8:
- Three Fizz messages carry `fizz_intro` and identical second timestamps.
- At 00:13:41 UTC the next task entered the non-cancelling steer path while Fizz
  was still working. No later completion was logged at inspection time.
- `welcomeKickoff.ts` stops scheduling forever when any owner message is found.
- `welcomeRuntimeIsReady` checks process lifecycle, not active turn completion.
- Generic Welcome cards still expose agent creation; sidebar scrolling can paint
  under the pinned search area. Fizz English labels also remain visible.

Changes started (not released): remove generic Welcome action cards and clip
sidebar content beneath its pinned header. Still require screenshot regression.

Next: establish completed-turn sequencing (not just first message receipt),
reliable bounded recovery without duplicate tasks, preserve owner input, fix
same-second message ordering, and add full sequence / greeting / reload tests.
Review semantic task queue policy: kickoff steps must not be merged into an
unfinished model turn as conversational steering.

Do not claim the goal complete until a unified demo/Mac candidate passes live
acceptance. Preserve current identity, organization and knowledge data. No repeat
blanket reset of customer data is needed for this targeted repair.

Progress at 00:26 UTC:
- Owner messages no longer permanently veto unfinished kickoff stages.
- Kickoff tasks bypass mid-turn steering and are isolated from adjacent queue
  batches (including ordinary owner messages). New queue regression passes.
- Kickoff prompt requests one short message, no premature question, and task exit.
- MCP combines a stage's paragraphs into one event, preserving internal order
  on same-second replay. Existing MCP tests updated; test process 93434 running.
- Nine kickoff tests pass; desktop TypeScript passes. Rust fmt passes.
- No new candidate installed yet. Live Fizz still has no logged completion after
  the 00:13:41 steer acknowledgement; needs diagnosis/recovery and live retest.
- Remaining: true completion/retry behavior, UI screenshot regression and stale
  Fizz labels, full gates, unified release and installed-app acceptance.

Progress at 00:36 UTC:
- All 14 role-scoped MCP tests pass; all 382 buzz-agent tests pass.
- Removed underlying English persona-pack subtitle for product agents; composer
  uses the locale's Fizz name and recognizes Cyrillic mentions.
- New Playwright Welcome layout test passes. Inspected screenshots under
  desktop/test-results/airhop-interface/welcome-{introduction,sidebar}.png.
- Added content-free INFO phase markers for model/tool/turn completion to make
  the installed runtime stall diagnosable. Current live processes sleep, no
  provider TCP connection at inspection time; sampled stack has no busy loop.
  This does not yet establish which async wait stalled.
- Full just ci now running; log /private/tmp/airhop-welcome-repair-ci.log.
- Follow-up MCP safeguard: only fizz_first_question may emit an airhop-question
  tag during kickoff. Recheck CI after this latest edit (it began before it).
  Current CI handle 18742; focused MCP follow-up launched separately.

Candidate 0.5.9 preparation:
- First CI failed the ChannelScreen 1000-line guard. Extracted label lookup into
  useChannelAgentLabels; guard passes, no exception added.
- New full CI: handle 72761, /private/tmp/airhop-welcome-repair-ci-059.log.
- Added total HTTP timeout alongside read timeout and a local dripping-response
  regression. This closes an unbounded provider-wait path; it is not yet proof
  that this path caused the observed demo stall.
- Demo image IDs rechecked unchanged from 0.5.8 before preparing deployment.
