import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { HttpStaffSiteAnalyticsService } from "./staffSiteAnalyticsService.ts";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LINK_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function signedEvent(input) {
  return {
    id: "event-id",
    pubkey: "staff-pubkey",
    created_at: 1,
    kind: input.kind,
    tags: input.tags,
    content: input.content,
    sig: "signature",
  };
}

function organization() {
  return {
    id: ORGANIZATION_ID,
    name: "Каляка Маляка",
    locale: "ru-RU",
    timeZone: "Europe/Moscow",
    defaultTrialPolicy: { mode: "free" },
    trackAttendanceByDefault: true,
    allowSingleVisitsByDefault: false,
    existingStudentsOnboarding: { status: "not_started" },
    publicBooking: { purpose: "trial", appearance: "automatic" },
    paymentDayOfMonth: 5,
  };
}

function link() {
  return {
    id: LINK_ID,
    slug: "ym-123456789abc",
    name: "Яндекс Карты",
    source: "yandex_maps",
    goal: "booking",
    destinationPath: "/booking/",
    branchId: null,
    status: "active",
    version: 1,
    openCount: 8,
    bookingCount: 2,
    contactClickCount: 1,
    createdAt: "2026-09-06T10:00:00Z",
  };
}

test("site analytics uses an exact signed period URL and validates the report", async () => {
  let signed;
  const service = new HttpStaffSiteAnalyticsService({
    relayHttpUrl: async () => "https://center.example/",
    nonceFactory: () => "analytics-nonce",
    signEvent: async (input) => {
      signed = input;
      return signedEvent(input);
    },
    fetch: async () =>
      new Response(
        JSON.stringify({
          organization: organization(),
          analytics: {
            periodStart: "2026-08-08",
            asOfDate: "2026-09-06",
            generatedAt: "2026-09-06T12:00:00Z",
            timeZone: "Europe/Moscow",
            firstEventAt: "2026-08-08T10:00:00Z",
            lastEventAt: "2026-09-06T11:00:00Z",
            pagesTruncated: false,
            sourcesTruncated: false,
            siteFunnel: {
              viewedSessions: 120,
              bookingSessions: 30,
              contactSessions: 8,
              bookedSessions: 10,
            },
            pages: [{ path: "/", views: 150, contactClicks: 8 }],
            contacts: [{ target: "phone", clicks: 8 }],
            totals: {
              visitors: 100,
              sessions: 120,
              pageViews: 150,
              bookingOpens: 30,
              bookingsCreated: 10,
              contactClicks: 8,
              bookingConversionBps: 3333,
            },
            days: [
              {
                date: "2026-09-06",
                visitors: 12,
                sessions: 15,
                bookingsCreated: 2,
                contactClicks: 1,
              },
            ],
            funnel: {
              opened: 30,
              basicsCompleted: 25,
              groupsCompleted: 20,
              occurrencesCompleted: 18,
              contactCompleted: 14,
              previewCompleted: 12,
              submitted: 11,
              created: 10,
            },
            sources: [
              {
                source: "yandex_maps",
                sessions: 40,
                trackedLinkOpens: 42,
                bookingsCreated: 6,
                contactClicks: 3,
              },
            ],
          },
        }),
      ),
  });

  const result = await service.getSiteAnalytics(30);
  assert.equal(result.analytics.totals.bookingsCreated, 10);
  assert.deepEqual(signed.tags.slice(0, 2), [
    ["u", "https://center.example/api/airhop/staff/v1/site-analytics?days=30"],
    ["method", "GET"],
  ]);
  await service.getSiteAnalytics(1, "yesterday");
  assert.equal(
    signed.tags[0][1],
    "https://center.example/api/airhop/staff/v1/site-analytics?days=1&until=yesterday",
  );
  await assert.rejects(
    service.getSiteAnalytics(1, "tomorrow"),
    /Invalid analytics period/,
  );
});

test("tracking link creation is signed, idempotent, and returns a copyable URL", async () => {
  const requests = [];
  const service = new HttpStaffSiteAnalyticsService({
    relayHttpUrl: async () => "https://center.example/",
    idempotencyKeyFactory: () => "tracking-link-command-0001",
    nonceFactory: () => "link-nonce",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      return new Response(
        JSON.stringify(
          init.method === "POST"
            ? { link: link(), replayed: false }
            : { redirectPath: "/go/", items: [link()] },
        ),
      );
    },
  });

  await service.createTrackingLink({
    name: "Яндекс Карты",
    source: "yandex_maps",
    goal: "booking",
    destinationPath: "/booking/",
  });
  const list = await service.listTrackingLinks();
  const create = requests[0];
  const body = create.init.body;
  const authorization = JSON.parse(
    Buffer.from(
      new Headers(create.init.headers).get("Authorization").slice(6),
      "base64",
    ).toString("utf8"),
  );

  assert.equal(
    new Headers(create.init.headers).get("Idempotency-Key"),
    "tracking-link-command-0001",
  );
  assert.deepEqual(
    authorization.tags.find(([name]) => name === "payload"),
    ["payload", createHash("sha256").update(body).digest("hex")],
  );
  assert.equal(
    `${list.redirectBaseUrl}${list.items[0].slug}`,
    "https://center.example/go/ym-123456789abc",
  );
});
