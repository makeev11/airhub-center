/** Checks an already-created demo link; no bookings or external messages. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "@playwright/test";
import { waitForAnimations } from "../tests/helpers/animations.ts";

const output = process.argv[2];
const url = new URL(process.argv[3]);
assert(output?.startsWith("/private/tmp/airhop-hygge-release."));
assert.equal(url.origin, "https://demo.airhop.ru");
assert(/^\/go\/[a-z0-9-]{3,80}$/.test(url.pathname));
assert(!url.search && !url.hash);
assert(process.argv.includes("--allow-demo-events"));
const slug = url.pathname.slice(4);
const tenant = "c88a2770-b2ca-4566-bcb3-fa3d8919a537";
function readCounts() {
  const sql = `BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT jsonb_build_object('source', l.source, 'destination', l.destination_path,
 'opens', count(*) FILTER (WHERE e.event_type='tracking_link_open'),
 'contacts', count(*) FILTER (WHERE e.event_type='contact_click'),
 'bookingOpens', count(*) FILTER (WHERE e.event_type='booking_opened'),
 'bookings', count(*) FILTER (WHERE e.event_type='booking_created'))
FROM airhop_tracking_links l LEFT JOIN airhop_site_analytics_events e
 ON e.community_id=l.community_id AND e.tracking_link_id=l.id
WHERE l.community_id='${tenant}' AND l.organization_id='7e510ed1-15a1-4a75-8d3d-33f924fe18a0' AND l.slug='${slug}'
GROUP BY l.id, l.source, l.destination_path;
ROLLBACK;`;
  return JSON.parse(
    execFileSync(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "StrictHostKeyChecking=yes",
        "root@46.173.25.23",
        "docker exec -i buzz-demo-postgres-1 psql -X -qAt -U buzz -d buzz --set ON_ERROR_STOP=1",
      ],
      { input: sql, encoding: "utf8" },
    ),
  );
}
const before = readCounts();
assert.equal(before.source, "yandex_maps");
assert.equal(before.destination, "/airhop/hygge/");
await writeFile(
  join(output, "tracking-attempt.json"),
  JSON.stringify({ url: url.href, before }),
  { flag: "wx" },
);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const ack = (type) =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/airhop/public/v1/analytics/events") &&
        response.status() === 202 &&
        JSON.parse(response.request().postData()).events.some(
          (event) => event.eventType === type,
        ),
    );
  const view = ack("site_page_view");
  await page.goto(url.href, { waitUntil: "networkidle" });
  await view;
  assert.equal(page.url(), "https://demo.airhop.ru/airhop/hygge/");
  assert(
    (await context.cookies()).some(
      (cookie) =>
        cookie.name === "airhop_attribution" &&
        cookie.httpOnly &&
        cookie.secure &&
        cookie.sameSite === "Lax",
    ),
  );
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  );
  const contact = ack("contact_click");
  await page
    .getByText("Проверить тестовый клик по контакту", { exact: false })
    .click();
  await contact;
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForAnimations(page);
  await page.screenshot({
    path: join(output, "hygge-mobile-live.png"),
    fullPage: true,
  });
  const opened = ack("booking_opened");
  const siteUrl = page.url();
  await page.locator("a[href='/booking']").click();
  await opened;
  assert.equal(page.url(), siteUrl);
  assert.equal(await page.getByRole("dialog").isVisible(), true);
  const after = readCounts();
  assert.equal(after.opens, before.opens + 1);
  assert.equal(after.contacts, before.contacts + 1);
  assert.equal(after.bookingOpens, before.bookingOpens + 1);
  assert.equal(after.bookings, before.bookings);
  assert.deepEqual(errors, []);
  const evidence = {
    verifiedAt: new Date().toISOString(),
    url: url.href,
    before,
    after,
    passed: [
      "same-origin redirect",
      "secure HttpOnly attribution",
      "contact and booking-open linked in PostgreSQL",
      "mobile overflow",
      "no JavaScript errors",
    ],
  };
  await writeFile(
    join(output, "tracking-evidence.json"),
    JSON.stringify(evidence, null, 2),
    { flag: "wx" },
  );
  console.log(JSON.stringify(evidence));
} finally {
  await browser.close();
}
