import assert from "node:assert/strict";
import test from "node:test";

import { JSDOM } from "jsdom";

import {
  createPublicBookingAnalyticsContext,
  trackPublicSiteAnalytics,
} from "./publicSiteAnalytics.ts";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

test("an idle booking form renews its session while keeping the same journey", async () => {
  await withBrowser("https://center.example/booking", ({ dom }) => {
    const context = createPublicBookingAnalyticsContext();
    const first = context.sessionId;
    const journey = context.journeyId;
    const saved = JSON.parse(
      dom.window.sessionStorage.getItem("airhop.analytics.session.v1"),
    );
    saved.expiresAt = Date.now() - 1;
    dom.window.sessionStorage.setItem(
      "airhop.analytics.session.v1",
      JSON.stringify(saved),
    );
    assert.notEqual(context.sessionId, first);
    assert.equal(context.journeyId, journey);
  });
});

async function withBrowser(url, callback) {
  const dom = new JSDOM("<!doctype html><p>AirHop</p>", {
    url,
    referrer: "https://yandex.ru/search/?text=children",
  });
  const previousWindow = globalThis.window;
  const previousDocument = globalThis.document;
  const previousFetch = globalThis.fetch;
  const requests = [];
  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.fetch = async (requestUrl, init) => {
    requests.push({ url: String(requestUrl), init });
    return Response.json(
      { accepted: JSON.parse(init.body).events.length, recorded: 1 },
      { status: 202 },
    );
  };
  dom.window.fetch = globalThis.fetch;
  try {
    await callback({ dom, requests });
  } finally {
    globalThis.window = previousWindow;
    globalThis.document = previousDocument;
    globalThis.fetch = previousFetch;
    dom.window.close();
  }
}

test("booking analytics reuses the site session attribution after navigation", async () => {
  await withBrowser(
    "https://center.example/?utm_source=yandex_maps&utm_campaign=autumn-trials",
    ({ dom }) => {
      const landing = createPublicBookingAnalyticsContext();
      dom.window.history.replaceState({}, "", "/booking");
      const booking = createPublicBookingAnalyticsContext();

      assert.equal(booking.visitorId, landing.visitorId);
      assert.equal(booking.sessionId, landing.sessionId);
      assert.notEqual(booking.journeyId, landing.journeyId);
      assert.equal(booking.source, "yandex_maps");
      assert.equal(booking.campaign, "autumn-trials");
      assert.equal(booking.referrerHost, "yandex.ru");
    },
  );
});

test("booking analytics replaces malformed browser identifiers", async () => {
  await withBrowser("https://center.example/booking", ({ dom }) => {
    dom.window.localStorage.setItem(
      "airhop.analytics.visitor.v1",
      "not-a-uuid",
    );
    dom.window.sessionStorage.setItem(
      "airhop.analytics.session.v1",
      JSON.stringify({ id: "broken", expiresAt: Date.now() + 60_000 }),
    );

    const context = createPublicBookingAnalyticsContext();

    assert.match(context.visitorId, UUID_PATTERN);
    assert.match(context.sessionId, UUID_PATTERN);
  });
});

test("collector sends privacy-reduced paths and persisted attribution", async () => {
  await withBrowser(
    "https://center.example/booking?utm_source=two_gis&utm_campaign=september#private",
    async ({ requests }) => {
      const context = createPublicBookingAnalyticsContext();
      trackPublicSiteAnalytics(context, [{ eventType: "booking_opened" }]);
      await window.__AIRHOP_ANALYTICS_DELIVERY__.flush();

      assert.equal(requests.length, 1);
      assert.equal(requests[0].url, "/api/airhop/public/v1/analytics/events");
      const payload = JSON.parse(requests[0].init.body);
      assert.equal(payload.events[0].path, "/booking");
      assert.equal(payload.events[0].source, "two_gis");
      assert.equal(payload.events[0].campaign, "september");
      assert.equal(JSON.stringify(payload).includes("private"), false);
      assert.equal(JSON.stringify(payload).includes("children"), false);
    },
  );
});

test("denied storage getters preserve the in-page identity and do not break booking", async () => {
  await withBrowser(
    "https://center.example/booking",
    async ({ dom, requests }) => {
      for (const key of ["localStorage", "sessionStorage"]) {
        Object.defineProperty(dom.window, key, {
          get() {
            throw new Error("SecurityError");
          },
        });
      }
      const first = createPublicBookingAnalyticsContext();
      const second = createPublicBookingAnalyticsContext();
      assert.equal(first.visitorId, second.visitorId);
      assert.equal(first.sessionId, second.sessionId);
      trackPublicSiteAnalytics(first, [
        { eventType: "booking_opened", journeyId: first.journeyId },
      ]);
      await window.__AIRHOP_ANALYTICS_DELIVERY__.flush();
      assert.equal(requests.length, 1);
    },
  );
});
