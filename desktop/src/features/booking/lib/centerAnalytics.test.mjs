import assert from "node:assert/strict";
import test from "node:test";
import { createInitialDemoBookingWorkspace } from "../data/demoBookingRepository.ts";
import { centerAnalyticsReportSchema } from "../data/centerAnalyticsSchema.ts";
import { HttpStaffSiteAnalyticsService } from "../data/staffSiteAnalyticsService.ts";
import {
  analyticsShare,
  analyticsSourceLabel,
  buildCenterAnalyticsPreview,
  shiftAnalyticsDate,
} from "./centerAnalytics.ts";

const now = new Date("2026-09-07T23:30:00Z");
const workspace = () => createInitialDemoBookingWorkspace("Pacific/Kiritimati");

test("calendar periods use organization timezone, yesterday is complete, and current capacity stays current", () => {
  const report = buildCenterAnalyticsPreview(workspace(), 1, "yesterday", now);
  assert.equal(report.today, "2026-09-08");
  assert.equal(report.periodStart, "2026-09-07");
  assert.equal(report.asOfDate, "2026-09-07");
  assert.equal(report.previousPeriodStart, "2026-09-06");
  assert.equal(report.previousPeriodEnd, "2026-09-06");
  assert.equal(report.isPartial, false);
  assert.equal(report.capacity.throughDate, "2026-09-14");
  assert.equal(report.days.length, 1);
  assert.equal(centerAnalyticsReportSchema.safeParse(report).success, true);
  assert.equal(
    buildCenterAnalyticsPreview(workspace(), 1, "today", now).isPartial,
    true,
  );
});

test("calendar arithmetic crosses DST/month/year boundaries without 24-hour assumptions", () => {
  assert.equal(shiftAnalyticsDate("2026-03-09", -1), "2026-03-08");
  assert.equal(shiftAnalyticsDate("2026-01-01", -1), "2025-12-31");
  assert.equal(shiftAnalyticsDate("2024-03-01", -1), "2024-02-29");
  assert.equal(analyticsShare("en-US", 0, 0), "—");
  assert.equal(analyticsShare("en-US", 0, 10), "0%");
  assert.equal(analyticsShare("en-US", 12, 10), "120%");
  assert.equal(
    analyticsSourceLabel("website", "ru-RU"),
    "Сайт · площадка неизвестна",
  );
});

test("schema rejects unsafe money, negative counts and invalid capacity without treating them as zero", () => {
  const report = buildCenterAnalyticsPreview(workspace(), 1, "yesterday", now);
  assert.equal(
    centerAnalyticsReportSchema.safeParse({
      ...report,
      attendance: { ...report.attendance, present: -1 },
    }).success,
    false,
  );
  assert.equal(
    centerAnalyticsReportSchema.safeParse({
      ...report,
      money: [
        {
          currency: "EUR",
          receiptsMinor: Number.MAX_SAFE_INTEGER + 1,
          refundsMinor: 0,
          outstandingMinor: 0,
          overdueMinor: 0,
        },
      ],
    }).success,
    false,
  );
});

test("Center read signs the complete period URL and preserves read-only transport guards", async () => {
  const w = workspace();
  let signed;
  let request;
  const service = new HttpStaffSiteAnalyticsService({
    relayHttpUrl: async () => "https://center.example/",
    nonceFactory: () => "center-nonce",
    signEvent: async (input) => {
      signed = input;
      return {
        ...input,
        id: "id",
        pubkey: "pubkey",
        sig: "sig",
        created_at: 1,
      };
    },
    fetch: async (url, init) => {
      request = { url, init };
      return new Response(
        JSON.stringify({
          organization: w.organization,
          analytics: buildCenterAnalyticsPreview(w, 1, "yesterday", now),
        }),
      );
    },
  });
  const report = await service.getCenterAnalytics(1, "yesterday");
  assert.equal(report.analytics.asOfDate, "2026-09-07");
  assert.equal(
    request.url,
    "https://center.example/api/airhop/staff/v1/booking-funnel-analytics?view=center&days=1&until=yesterday",
  );
  assert.deepEqual(signed.tags.slice(0, 2), [
    ["u", request.url],
    ["method", "GET"],
  ]);
  assert.equal(request.init.credentials, "omit");
  assert.equal(request.init.redirect, "error");
  for (const days of [0, 367, NaN, 1.5])
    await assert.rejects(
      service.getCenterAnalytics(days),
      /Invalid analytics period/,
    );
  await assert.rejects(
    service.getCenterAnalytics(1, "tomorrow"),
    /Invalid analytics period/,
  );
});

test("failed or incompatible server reads never produce a demo report", async () => {
  const options = {
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => ({ ...input }),
  };
  await assert.rejects(
    new HttpStaffSiteAnalyticsService({
      ...options,
      fetch: async () => new Response("{}", { status: 503 }),
    }).getCenterAnalytics(),
    { status: 503 },
  );
  await assert.rejects(
    new HttpStaffSiteAnalyticsService({
      ...options,
      fetch: async () => new Response("{}"),
    }).getCenterAnalytics(),
    { status: 502 },
  );
});
