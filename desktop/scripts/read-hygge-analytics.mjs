/** Read-only database evidence for the approved demo; not a substitute for staff auth QA. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

const output = process.argv[2];
assert(output?.startsWith("/private/tmp/airhop-hygge-release."));
// A browser assertion can fail after a successful booking. Audit that exact
// attempt without creating another booking, and clearly label this evidence.
const recoverAttempt = process.argv.includes("--from-accepted-attempt");
const evidence = JSON.parse(
  await readFile(
    join(output, recoverAttempt ? "live-attempt.json" : "live-evidence.json"),
    "utf8",
  ),
);
assert(/^hygge_acceptance_\d+$/.test(evidence.campaign));
if (recoverAttempt)
  assert.equal(evidence.campaign, "hygge_acceptance_1788802763259");
else for (const id of evidence.eventIds) assert(/^[0-9a-f-]{36}$/.test(id));
const reportSql = await readFile(
  new URL(
    "../../crates/buzz-db/src/airhop/site_analytics/report.sql",
    import.meta.url,
  ),
  "utf8",
);
const tenant = "c88a2770-b2ca-4566-bcb3-fa3d8919a537";
const organization = "7e510ed1-15a1-4a75-8d3d-33f924fe18a0";
const sql = `BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT jsonb_build_object(
 'events', count(*), 'uniqueEvents', count(DISTINCT event_id),
 'visitors', count(DISTINCT visitor_digest), 'sessions', count(DISTINCT session_digest),
 'organizations', count(DISTINCT organization_id), 'communities', count(DISTINCT community_id),
 'correctTenant', bool_and(community_id='${tenant}' AND organization_id='${organization}'),
 'pageViews', count(*) FILTER (WHERE event_type='site_page_view'),
 'contacts', count(*) FILTER (WHERE event_type='contact_click'),
 'bookingOpens', count(*) FILTER (WHERE event_type='booking_opened'),
 'bookingCreated', count(*) FILTER (WHERE event_type='booking_created'),
 'journeys', count(DISTINCT journey_id),
 'createdBookingIds', coalesce(jsonb_agg(booking_id) FILTER (WHERE event_type='booking_created'), '[]'),
 'completedSteps', coalesce(jsonb_agg(DISTINCT step) FILTER (WHERE event_type='booking_step_completed'), '[]'),
 'campaignPreserved', bool_and(campaign='${evidence.campaign}'),
 'sourcePreserved', bool_and(source='hygge_acceptance')
) FROM airhop_site_analytics_events WHERE campaign='${evidence.campaign}';
PREPARE pilot_report(uuid,uuid,date,date,text) AS ${reportSql};
EXECUTE pilot_report('${tenant}', '${organization}', (now() AT TIME ZONE 'Europe/Moscow')::date-6, (now() AT TIME ZONE 'Europe/Moscow')::date, 'Europe/Moscow');
ROLLBACK;`;
const response = execFileSync(
  "ssh",
  [
    "-o",
    "BatchMode=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "root@46.173.25.23",
    "docker exec -i buzz-demo-postgres-1 psql -X -qAt -U buzz -d buzz --set ON_ERROR_STOP=1",
  ],
  { input: sql, encoding: "utf8", maxBuffer: 1024 * 1024 },
);
const lines = response.trim().split("\n");
assert.equal(lines.length, 2);
const summary = JSON.parse(lines[0]);
const report = JSON.parse(lines[1]);
assert.equal(
  summary.events,
  recoverAttempt ? 17 : evidence.eventIds.length + 1,
);
assert.equal(summary.events, summary.uniqueEvents);
assert.equal(summary.visitors, 1);
assert.equal(summary.sessions, 1);
assert.equal(summary.organizations, 1);
assert.equal(summary.communities, 1);
assert.equal(summary.correctTenant, true);
assert.equal(summary.campaignPreserved, true);
assert.equal(summary.sourcePreserved, true);
assert.equal(summary.contacts, 1);
assert.equal(summary.bookingOpens, 1);
assert.equal(summary.bookingCreated, 1);
assert.equal(summary.createdBookingIds.length, 1);
assert.equal(summary.journeys, 1);
assert.deepEqual(
  summary.completedSteps.sort(),
  recoverAttempt
    ? ["basics", "contact", "groups", "occurrences", "preview"]
    : evidence.completedSteps,
);
if (recoverAttempt)
  assert.deepEqual(summary.createdBookingIds, [
    "b34ba163-6d81-404d-95f2-3ead7692e325",
  ]);
summary.evidenceOrigin = recoverAttempt
  ? "database audit of accepted browser attempt; browser harness stopped on incorrect replayed-field comparison"
  : "browser and database reconciliation";
assert.equal(report.timeZone, "Europe/Moscow");
assert(
  report.sources.some(
    (item) => item.source === "hygge_acceptance" && item.bookingsCreated >= 1,
  ),
);
await writeFile(
  join(output, "database-evidence.json"),
  JSON.stringify(summary, null, 2),
  { flag: "wx" },
);
await writeFile(
  join(output, "site-report.json"),
  JSON.stringify(report, null, 2),
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    summary,
    reportTotals: report.totals,
    timeZone: report.timeZone,
    generatedAt: report.generatedAt,
  }),
);
