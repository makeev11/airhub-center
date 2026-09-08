/** Explicit demo-only acceptance: synthetic telemetry and one pending test booking. */
import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium, expect } from "@playwright/test";
import { waitForAnimations } from "../tests/helpers/animations.ts";

assert(
  process.argv.includes("--allow-demo-events"),
  "Explicit demo telemetry approval required",
);
assert(
  process.argv.includes("--allow-demo-booking"),
  "Explicit approval for one synthetic demo booking required",
);
const output = process.argv[2];
assert(output?.startsWith("/private/tmp/airhop-hygge-release."));
const origin = "https://demo.airhop.ru";
const campaign = `hygge_acceptance_${Date.now()}`;
const endpoint = `${origin}/api/airhop/public/v1/analytics/events`;
// A failed assertion after submission must not silently create a second booking
// on the next invocation. Inspect this campaign before starting another run.
await writeFile(
  join(output, "live-attempt.json"),
  JSON.stringify({ startedAt: new Date().toISOString(), origin, campaign }),
  { flag: "wx" },
);
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  const errors = [];
  const requests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (request) => {
    if (request.url() === endpoint && request.method() === "POST")
      requests.push(JSON.parse(request.postData()));
  });
  const ack = (type) =>
    page.waitForResponse(
      (response) => {
        if (response.url() !== endpoint || response.status() !== 202)
          return false;
        return JSON.parse(response.request().postData()).events.some(
          (event) => event.eventType === type,
        );
      },
      { timeout: 20000 },
    );
  const viewAck = ack("site_page_view");
  await page.goto(
    `${origin}/airhop/hygge/?utm_source=hygge_acceptance&utm_campaign=${campaign}`,
    { waitUntil: "networkidle" },
  );
  await viewAck;
  await page
    .locator("[data-hygge-status]")
    .filter({ hasText: /нет доступных занятий|Ближайшие занятия/ })
    .waitFor();
  const first = requests[0];
  const sessionId = first.events[0].sessionId;
  const visitorId = first.events[0].visitorId;
  assert.equal(first.events[0].campaign, campaign);
  assert.equal(first.events[0].path, "/airhop/hygge/");
  const duplicate = await context.request.post(endpoint, {
    data: first,
    headers: { origin },
  });
  assert.equal(duplicate.status(), 202);
  assert.deepEqual(await duplicate.json(), {
    accepted: first.events.length,
    recorded: 0,
  });
  const contactAck = ack("contact_click");
  await page
    .getByText("Проверить тестовый клик по контакту", { exact: false })
    .click();
  await contactAck;
  await page.evaluate(() => window.scrollTo(0, 0));
  await waitForAnimations(page);
  await page.screenshot({
    path: join(output, "hygge-live.png"),
    fullPage: true,
  });
  const openedAck = ack("booking_opened");
  const siteUrl = page.url();
  await page.locator("a[href='/booking']").click();
  const booking = page.frameLocator("[data-hygge-booking-frame]");
  await openedAck;
  // Center may keep background requests active; wait for the actual form.
  await expect(booking.getByTestId("airhop-public-flow")).toBeVisible();
  assert.equal(page.url(), siteUrl);
  const sent = requests.flatMap((request) => request.events);
  const opened = sent.find((event) => event.eventType === "booking_opened");
  const contact = sent.find((event) => event.eventType === "contact_click");
  for (const event of [opened, contact]) {
    assert.equal(event.sessionId, sessionId);
    assert.equal(event.visitorId, visitorId);
    assert.equal(event.source, "hygge_acceptance");
    assert.equal(event.campaign, campaign);
  }
  assert.equal(contact.target, "other");
  assert.equal(opened.path, "/booking");
  await waitForAnimations(page);
  await page.screenshot({ path: join(output, "booking-live.png") });

  // Fixed, fictional demo organization only. Do not select a real customer or
  // enable messaging, confirm the booking, or collect a payment.
  const catalog = await context.request.get(
    `${origin}/api/airhop/public/v1/catalog`,
  );
  assert.equal(
    (await catalog.json()).organization.id,
    "7e510ed1-15a1-4a75-8d3d-33f924fe18a0",
  );
  const available = await context.request.get(
    `${origin}/api/airhop/public/v1/occurrences?ageYears=5`,
  );
  const occurrence = (await available.json()).occurrences.find(
    (item) =>
      item.groupId === "efe9a283-2e6c-4a57-a3c8-32120ca5a540" && item.available,
  );
  assert(
    occurrence,
    "An available lesson in the approved fictional group is required",
  );
  const selectedBranch = booking.getByTestId("airhop-public-selected-branch");
  if (!(await selectedBranch.isVisible()))
    await booking
      .getByTestId(`airhop-public-branch-${occurrence.branchId}`)
      .click();
  await booking.getByTestId("airhop-public-age-5").click();
  await booking.getByRole("button", { name: "Продолжить" }).click();
  await booking
    .getByTestId(`airhop-public-group-${occurrence.groupId}`)
    .click();
  await booking.getByRole("button", { name: "Продолжить" }).click();
  await booking
    .getByTestId(
      `airhop-public-occurrence-${occurrence.lessonRef.recurrenceRuleId}:${occurrence.lessonRef.originalDate}`,
    )
    .click();
  await booking.getByRole("button", { name: "Продолжить" }).click();
  await booking.getByLabel("Имя родителя").fill("Тест аналитики — родитель");
  await booking.getByLabel("Телефон").fill("+12025550124");
  await booking.getByLabel("Имя ребёнка").fill("Тест аналитики — ребёнок");
  await booking.getByLabel("Точная дата рождения ребёнка").fill("2021-01-15");
  await booking.getByRole("checkbox").click();
  await booking.getByRole("button", { name: "Продолжить" }).click();
  await expect(booking.getByTestId("airhop-public-preview")).toBeVisible();
  const submitAck = ack("booking_submit");
  const bookingResponse = page.waitForResponse(
    (response) =>
      response.url() === `${origin}/api/airhop/public/v1/bookings` &&
      response.request().method() === "POST",
  );
  await booking.getByTestId("airhop-public-submit").click();
  const created = await bookingResponse;
  assert(created.ok(), `Test booking returned HTTP ${created.status()}`);
  console.log(JSON.stringify({ campaign, testBookingAccepted: true }));
  const createPayload = JSON.parse(created.request().postData());
  assert.equal(createPayload.preferredContactChannel, "none");
  const createdBody = await created.json();
  await expect(booking.getByTestId("airhop-public-success")).toContainText(
    "Заявка ожидает подтверждения",
  );
  await submitAck;
  const replay = await context.request.post(created.url(), {
    data: createPayload,
    headers: {
      origin,
      "Idempotency-Key": created.request().headers()["idempotency-key"],
    },
  });
  assert(replay.ok(), `Idempotent replay returned HTTP ${replay.status()}`);
  const replayBody = await replay.json();
  assert.equal(replayBody.replayed, true);
  assert.equal(createdBody.replayed, false);
  // Compare credentials in memory, never attach them to an assertion diff.
  assert(
    replayBody.managementToken === createdBody.managementToken,
    "Replay must preserve the management token",
  );
  assert.equal(replayBody.bookingId, createdBody.bookingId);
  assert.equal(replayBody.status, createdBody.status);
  assert.deepEqual(replayBody.lessonRef, createdBody.lessonRef);
  await waitForAnimations(page);
  await page.screenshot({ path: join(output, "booking-success-live.png") });
  const crossOrigin = await context.request.post(endpoint, {
    data: first,
    headers: { origin: "https://other.example" },
  });
  assert.equal(crossOrigin.status(), 403);
  const forged = await context.request.post(endpoint, {
    data: { events: [{ ...first.events[0], eventType: "booking_created" }] },
    headers: { origin },
  });
  assert.equal(forged.status(), 422);
  const privateReport = await context.request.get(
    `${origin}/api/airhop/staff/v1/site-analytics?days=7`,
  );
  assert.equal(privateReport.status(), 401);
  assert.deepEqual(errors, []);
  const allSent = requests.flatMap((request) => request.events);
  const completedSteps = [
    ...new Set(
      allSent
        .filter((event) => event.eventType === "booking_step_completed")
        .map((event) => event.step),
    ),
  ];
  assert.deepEqual(completedSteps.sort(), [
    "basics",
    "contact",
    "groups",
    "occurrences",
    "preview",
  ]);
  assert(!JSON.stringify(allSent).includes("12025550124"));
  assert(!JSON.stringify(allSent).includes("Тест аналитики"));
  const evidence = {
    verifiedAt: new Date().toISOString(),
    origin,
    campaign,
    sessionId,
    visitorId,
    eventIds: [...new Set(allSent.map((event) => event.eventId))],
    eventTypes: [...new Set(allSent.map((event) => event.eventType))],
    journeyId: opened.journeyId,
    completedSteps,
    testBooking: {
      status: "pending",
      lessonRef: occurrence.lessonRef,
      contactChannel: "none",
      replayPassed: true,
    },
    passed: [
      "real browser ingest",
      "deduplication",
      "contact",
      "same session and source across site/booking",
      "forged booking rejected",
      "cross-origin rejected",
      "report requires authentication",
      "all five booking steps",
      "one pending synthetic booking and idempotent replay",
      "no applicant data in browser analytics",
    ],
    notTested: [
      "authenticated employee/Analyst report",
      "tracking-link creation",
      "payments and outbound messages (intentionally not performed)",
    ],
  };
  await writeFile(
    join(output, "live-evidence.json"),
    JSON.stringify(evidence, null, 2),
    { flag: "wx" },
  );
  console.log(JSON.stringify(evidence));
} finally {
  await browser.close();
}
