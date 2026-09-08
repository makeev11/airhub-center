# Center analytics: implementation contract

The destination is the existing React/Tauri Analytics screen, not a separate
dashboard service. Its audience is the center owner. The default overview answers
how bookings become attendance and permanent enrollment, what is happening with
payments, whether students return, and where next week's places remain.

## Sources and grains

- Browser events remain anonymous and unchanged. A server-written
  `booking_created.booking_id` supplies optional acquisition attribution.
- Booking cohort: bookings created in the selected local-calendar window;
  downstream outcomes are observed as of report generation. Include trial and
  single bookings; direct permanent enrollments remain visible separately.
- Trial-to-enrollment linkage uses the existing audited conversion event, never
  a guessed child/name match. One enrollment has one canonical originating
  booking. Unknown acquisition is displayed explicitly.
- Attendance: explicit present/absent marks on completed, non-cancelled lessons.
  A missing mark is not absence. Track lessons with attendance enabled but no
  marks separately. This is not an immutable historical roster reconstruction.
- Repeat attendance: distinct children present in each adjacent equal calendar
  window and their intersection. This is observed return, not contractual churn.
- Repeat payments: distinct enrollments with a receipt in the window and a
  positive current net balance both in that billing period and an earlier one.
  Partial payments count; fully refunded balances do not. Not contractual renewal.
- Current students: distinct children with active, configured, date-effective
  enrollments; multiple groups do not multiply student counts.
- Capacity: next seven local dates, materialized non-cancelled occurrences,
  deduplicated booking/enrollment roster following the operational schedule
  contract. Pending bookings reserve places. Unknown capacity is not zero.
- Money: actual receipts/refunds by transaction date, currencies separate;
  outstanding debt is a current snapshot. Billing-month analytics stays a separate
  existing view and is not relabelled as cash received during this window.
- Source outcomes: results of this booking cohort through explicit enrollment
  linkage. Attributed money is net receipts on those enrollments through report
  time, not cash-flow totals for the selected dates.

## Implementation and guardrails

Default to yesterday's complete local calendar day (`days=1&until=yesterday`),
not the previous 24 hours. Today and 7/30/90/366-day windows include the partial
current day. Explicit date-to-timestamp timezone conversion prevents PostgreSQL
session timezone from shifting boundaries (also fixed in the website report).

Extend the existing protected booking-funnel read with `view=center&days=N&until=today|yesterday`;
retain its legacy response without that query. This avoids a parallel endpoint
or a new write protocol. Desktop, CLI and Analyst read the same aggregate.
The report uses one read-only, repeatable-read transaction, a bounded window
(1–366 days), statement timeout, bounded detail arrays with truncation flags,
host-derived tenancy and no personal identifiers in the output.

New report controls apply only to the views they actually change. Existing
six-month billing/cohort reports and all-time links carry their own period labels.
No current report is shown as successfully refreshed after a failed request.
Switching communities must drop previous tenant data. Preview data is explicitly
labelled and never used as a production fallback.

## Chart map and UI

Native app primitives, stock type/spacing/color tokens; no chart dependency on
the public site. Summary → trend → breakdown → exact details.

| View | Question | Encoding | Context / fallback |
| --- | --- | --- | --- |
| Overview | How many bookings and actual visits? | daily zero-based bars, metric selector | local dates, today's partial state; sparse data stays discrete bars |
| Acquisition | Which origins produce operational outcomes? | exact table, human-readable names | booking cohort, unknown attribution, currency-safe net amounts |
| Attendance | What was explicitly recorded? | present/absent counts and group table | unmarked lessons shown separately, no inferred no-shows |
| Students | Are previously observed children returning? | numerator/denominator cards | adjacent windows, partial current period, not churn |
| Capacity | Which coming lessons have room? | labelled occupied/capacity bars and detail table | next seven days; unknown and over-capacity explicit |
| Money | What actually moved? | currency-specific receipt/refund/net cards | transaction dates; current debt separate |

Use a single neutral/primary chart root with direct labels; attendance states
are also named in text. No invented benchmarks or causal Analyst conclusions.

## Verification

Backend integration tests: tenant isolation, zero/unknown, cancellation,
duplicate join prevention, moved lessons, selected enrollment weekdays,
repeat attendance, direct enrollment, partial payments/refunds, multiple
currencies, attribution and bounds. Client tests: schema/auth/query validation,
period and ratio semantics. E2E: overview/tabs/filters, empty/error states,
responsive layout and screenshots through the approved mock bridge.

## Release boundary

Changes are local source code, not an installed desktop or server release.
Migration 0054 adds indexes only; the old funnel read remains backward-compatible.
Deploy the server contract before upgrading clients. Existing saved Analyst
persona overrides are not overwritten; the tool schema supplies the new read
contract. The new persona prompt applies to newly created/default personas.

## Verification evidence — 2026-09-07

- PostgreSQL 18, isolated temporary cluster: both analytics integration tests
  passed. Coverage includes two populated tenants, duplicate conversion events,
  explicit attendance/cancelled and moved lessons, original-weekday enrollment
  selection, partial payments/refunds and repeat payments, separate currencies,
  direct/unattributed enrollment, empty data and 1/366-day bounds.
- Organization `Pacific/Kiritimati` with database session `America/Sao_Paulo`:
  yesterday's site and Center facts agree. This caught and fixed the previous
  website SQL's ambiguous `date AT TIME ZONE` conversion.
- Local synthetic sample: Center report 15.6 ms with 10,000 unrelated page events;
  site report 464.7 ms over 50,005 events. These are single local checks, not a
  production latency SLA or a representative operational-scale benchmark.
- Real PostgreSQL JSON parsed successfully with the desktop Zod contract.
- Rust library regressions: CLI 317, DB 187 (176 infrastructure tests skipped),
  dev-MCP 109 passed. Staff endpoint tests: 20 passed, including strict date query
  validation and role restrictions. Analytics DB integration tests above were
  run explicitly despite their default ignored status.
- Seven date/schema/auth/service tests and 13 public-collector/delivery tests passed.
- Four Playwright scenarios passed: analytics route, all operational sections,
  yesterday/current period and narrow layout; primary report rendering while
  optional reads are held; partial/primary failures without demo fallback;
  source-table filtering, independent currencies and negative net cash;
  late responses cannot replace a more recently selected period.
- Screenshots visually inspected: yesterday, populated trend/source/money,
  capacity, narrow and empty states. All numbers in screenshots are synthetic.
- TypeScript and `build:e2e` passed. Full workspace Rust fmt and strict Clippy
  passed; desktop Biome checked 2,094 files successfully. The initial `just ci`
  stopped at the existing `PublicBookingFlow.tsx` size ratchet (1,002 lines vs
  1,000 allowed). In the user-approved follow-up, its unchanged bottom action
  panel was extracted into `PublicBookingOccurrenceActions.tsx`; the complete
  desktop `pnpm check` now passes (2,095 files). TypeScript and `build:e2e` were
  rerun successfully. During the subsequent demo/local release preparation,
  the full multi-platform `just ci` also passed. No server or installed app
  was updated. The initial artifact record is historical; use
  [the unified 0.5.6 candidate process](AIRHOP_CENTER_RELEASE.md) for the current
  source identity, artifacts and deployment boundaries.

Reproduce UI checks with `AIRHOP_E2E_PORT=4187 pnpm exec playwright test
--project=airhop-center airhop-center-analytics.spec.ts airhop-schedule.spec.ts
--grep 'server analytics|late analytics response|payment analytics route|Center analytics supports'`
after `pnpm build:e2e`. Database tests use an explicitly isolated
`BUZZ_TEST_DATABASE_URL` and `cargo test -p buzz-db analytics -- --ignored --nocapture`.
