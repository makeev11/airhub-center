import assert from "node:assert/strict";
import { chromium } from "@playwright/test";
import { waitForAnimations } from "../tests/helpers/animations.ts";
const base = process.env.BOOKING_TEST_ORIGIN;
if (!base)
  throw new Error(
    "Set BOOKING_TEST_ORIGIN to the explicitly approved Hygge test environment",
  );
const browser = await chromium.launch({ headless: true });
try {
  for (const mode of ["standalone", "embedded"])
    for (const viewport of [
      { width: 418, height: 704 },
      { width: 320, height: 568 },
      { width: 1280, height: 800 },
    ]) {
      const page = await browser.newPage({ viewport });
      if (base.startsWith("http:"))
        await page.route("**/api/airhop/public/v1/**", async (route) => {
          const url = new URL(route.request().url());
          if (
            url.pathname === "/api/airhop/public/v1/analytics/events" &&
            route.request().method() === "POST"
          ) {
            // The merged analytics build emits telemetry. Acknowledge it only
            // inside this local test; never forward writes to the demo.
            const count = route.request().postDataJSON().events.length;
            await route.fulfill({
              status: 202,
              json: { accepted: count, recorded: count },
            });
            return;
          }
          assert.equal(
            route.request().method(),
            "GET",
            "This visual test must not write bookings",
          );
          const res = await page.request.get(
            `https://demo.airhop.ru${url.pathname}${url.search}`,
          );
          await route.fulfill({ response: res });
        });
      await page.goto(
        base + (mode === "embedded" ? "/booking/demo-host" : "/booking"),
      );
      if (mode === "embedded")
        await page.getByTestId("airhop-public-widget-launcher").click();
      await page.getByRole("button", { name: /Хюге.*Есть места/ }).click();
      await page.getByRole("button", { name: "4 года", exact: true }).click();
      await page
        .getByRole("button", { name: "Продолжить", exact: true })
        .click();
      await page.getByRole("button", { name: /^Краски и истории/ }).click();
      await page
        .getByRole("button", { name: "Продолжить", exact: true })
        .click();
      const dock = page.getByTestId("airhop-public-occurrence-actions");
      assert.equal(await dock.count(), 0);
      await page
        .locator('[data-testid^="airhop-public-occurrence-"]')
        .first()
        .click();
      await dock.waitFor();
      const next = dock.getByRole("button", {
        name: "Продолжить",
        exact: true,
      });
      const before = await next.boundingBox();
      assert(before.y >= 0 && before.y + before.height <= viewport.height);
      assert(
        await page
          .getByTestId("airhop-public-flow")
          .evaluate((el) => el.scrollHeight > el.clientHeight),
      );
      await page.getByTestId("airhop-public-flow").evaluate((el) => {
        el.scrollTop = el.scrollHeight / 2;
      });
      await waitForAnimations(page);
      const after = await next.boundingBox();
      assert.equal(before.y, after.y);
      assert(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      );
      if (viewport.width === 418)
        await page.screenshot({
          path:
            "/private/tmp/hygge-sticky-" +
            (base.startsWith("https:") ? "live" : "preview") +
            ".png",
        });
      await next.click();
      await page
        .getByRole("heading", { name: "Контакты для заявки" })
        .waitFor();
      assert.equal(await dock.count(), 0);
      console.log(
        JSON.stringify({
          mode,
          viewport,
          buttonVisible: true,
          positionStable: true,
          contactStep: true,
          origin: base,
        }),
      );
      await page.close();
    }
} finally {
  await browser.close();
}
