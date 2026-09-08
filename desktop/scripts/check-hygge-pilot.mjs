/** Local fixture QA for the exported pilot; never writes to a remote Center. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { chromium } from "@playwright/test";
import { waitForAnimations } from "../tests/helpers/animations.ts";

const root = process.argv[2];
assert(root?.startsWith("/private/tmp/airhop-hygge-release."));
const events = [];
const mime = {
  ".html": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
};
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/booking") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end("<button>Тест общей формы</button>");
      return;
    }
    if (url.pathname === "/api/airhop/public/v1/analytics/events") {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);
      assert(body.length <= 16384);
      const batch = JSON.parse(body).events;
      events.push(...batch);
      res.writeHead(202, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ accepted: batch.length, recorded: batch.length }),
      );
      return;
    }
    assert(url.pathname.startsWith("/airhop/hygge/"));
    let relative = decodeURIComponent(
      url.pathname.slice("/airhop/hygge/".length),
    );
    if (!relative || relative.endsWith("/")) relative += "index.html";
    const path = resolve(root, relative);
    assert(path.startsWith(`${root}/`));
    const body = await readFile(path);
    res.writeHead(200, {
      "content-type": mime[extname(path)] || "application/octet-stream",
    });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
try {
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  });
  let wrongTenant = false;
  await context.route(
    "https://demo.airhop.ru/api/airhop/public/v1/catalog",
    (route) =>
      route.fulfill({
        json: {
          organization: {
            id: wrongTenant ? "wrong" : "7e510ed1-15a1-4a75-8d3d-33f924fe18a0",
            timeZone: "Europe/Moscow",
          },
          branches: [{}],
        },
      }),
  );
  await context.route(
    "https://demo.airhop.ru/api/airhop/public/v1/occurrences?*",
    (route) =>
      route.fulfill({
        json: {
          occurrences: [
            {
              available: true,
              groupId: "00000000-0000-4000-8000-000000000001",
              groupName: "Тестовое занятие",
              date: "2026-09-12",
              startTime: "11:00",
              endTime: "12:00",
              trialPolicy: {
                mode: "paid",
                price: { amountMinor: 90000, currency: "RUB" },
              },
            },
          ],
        },
      }),
  );
  const page = await context.newPage();
  const failures = [];
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      failures.push(`${response.status()} ${response.url()}`);
  });
  const telemetry = () =>
    page.waitForResponse(
      (response) =>
        response.url().endsWith("/analytics/events") &&
        response.status() === 202,
    );
  const viewAck = telemetry();
  await page.goto(
    `${origin}/airhop/hygge/?utm_source=hygge_qa&utm_campaign=local_fixture`,
  );
  await viewAck;
  await page.getByText("Тестовое занятие", { exact: true }).waitFor();
  assert.equal(await page.locator("form").count(), 0);
  assert.equal(await page.locator("a[href='/booking']").count(), 1);
  assert.equal(await page.locator("script[src]").count(), 2);
  assert.equal(await page.locator("iframe").count(), 0);
  const siteUrl = page.url();
  await page.locator("a[href='/booking']").click();
  await page
    .getByRole("dialog", { name: "Запись на занятие в Хюге" })
    .waitFor();
  const fixture = page
    .frameLocator("[data-hygge-booking-frame]")
    .getByRole("button");
  await fixture.click();
  assert.equal(page.url(), siteUrl);
  await fixture.press("Escape");
  assert.equal(await page.getByRole("dialog").isVisible(), false);
  assert(
    await page
      .locator("a[href='/booking']")
      .evaluate((el) => el === document.activeElement),
  );
  await page.locator("a[href='/booking']").click();
  assert.equal(await page.locator("iframe").count(), 1);
  await page.getByRole("button", { name: "Закрыть запись ×" }).click();
  assert.equal(
    events.filter((e) => e.eventType === "site_page_view").length,
    1,
  );
  const session = events[0].sessionId;
  const clickAck = telemetry();
  await page
    .getByText("Проверить тестовый клик по контакту", { exact: false })
    .click();
  await clickAck;
  const contact = events.find((e) => e.eventType === "contact_click");
  assert.equal(contact.sessionId, session);
  assert.equal(contact.target, "other");
  assert.equal(contact.source, "hygge_qa");
  const nextAck = telemetry();
  await page.locator("a[href='/airhop/hygge/brief/']").first().click();
  await nextAck;
  assert.equal(events.at(-1).sessionId, session);
  assert.equal(events.at(-1).source, "hygge_qa");
  await page.goto(`${origin}/airhop/hygge/`);
  await page.getByText("Тестовое занятие", { exact: true }).waitFor();
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await waitForAnimations(page);
    assert(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    );
    await page.screenshot({
      path: join(root, `../hygge-${width}.png`),
      fullPage: true,
    });
  }
  wrongTenant = true;
  await page.reload();
  await page
    .getByText("Привязка организации изменилась.", { exact: false })
    .waitFor();
  assert.equal(await page.locator("a[href^='/booking']").isVisible(), false);
  assert.deepEqual(failures, []);
  console.log(
    JSON.stringify({
      passed: [
        "live catalog",
        "lazy shared booking modal, unchanged site URL, Escape and focus restoration",
        "page view",
        "contact click",
        "same session across pages",
        "source attribution",
        "wrong tenant fails closed",
        "desktop/mobile no overflow",
        "no failed assets or JS errors",
      ],
      events: events.length,
    }),
  );
} finally {
  await browser.close();
  await new Promise((done) => server.close(done));
}
