/** Negative tests only: no accepted analytics or booking writes. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

const output = process.argv[2];
assert(output?.startsWith("/private/tmp/airhop-hygge-release."));
const origin = "https://demo.airhop.ru";
const endpoint = `${origin}/api/airhop/public/v1/analytics/events`;
const event = {
  eventId: randomUUID(),
  eventType: "site_page_view",
  occurredAt: new Date().toISOString(),
  visitorId: randomUUID(),
  sessionId: randomUUID(),
  path: "/airhop/hygge/",
};
async function rejected(payload, requestOrigin, expected) {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json", origin: requestOrigin },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15000),
  });
  assert.equal(response.status, expected);
  return response.status;
}
const evidence = {
  crossOrigin: await rejected(
    { events: [event] },
    "https://other.example",
    403,
  ),
  forgedConversion: await rejected(
    { events: [{ ...event, eventType: "booking_created" }] },
    origin,
    422,
  ),
  unauthenticatedReport: (
    await fetch(`${origin}/api/airhop/staff/v1/site-analytics?days=7`, {
      signal: AbortSignal.timeout(15000),
    })
  ).status,
};
assert.equal(evidence.unauthenticatedReport, 401);
await writeFile(
  join(output, "public-guards-evidence.json"),
  JSON.stringify(evidence, null, 2),
  { flag: "wx" },
);
console.log(JSON.stringify(evidence));
