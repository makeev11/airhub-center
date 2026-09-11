// Component visual QA: run with `node --import ./test-loader.mjs scripts/review-site-analytics.mjs`.
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { chromium } from "@playwright/test";
import { SiteAnalyticsView } from "../src/features/booking/ui/SiteAnalyticsView.tsx";
import { waitForAnimations } from "../tests/helpers/animations.ts";

const report = {
  periodStart: "2026-09-01",
  asOfDate: "2026-09-07",
  generatedAt: "2026-09-07T12:00:00Z",
  timeZone: "Europe/Moscow",
  firstEventAt: "2026-09-01T09:00:00Z",
  lastEventAt: "2026-09-07T11:58:00Z",
  totals: {
    visitors: 100,
    sessions: 120,
    pageViews: 180,
    bookingOpens: 20,
    bookingsCreated: 7,
    contactClicks: 12,
    bookingConversionBps: 2500,
  },
  siteFunnel: {
    viewedSessions: 120,
    bookingSessions: 20,
    contactSessions: 10,
    bookedSessions: 5,
  },
  funnel: {
    opened: 20,
    basicsCompleted: 18,
    groupsCompleted: 16,
    occurrencesCompleted: 12,
    contactCompleted: 10,
    previewCompleted: 8,
    submitted: 7,
    created: 5,
  },
  days: Array.from({ length: 7 }, (_, i) => ({
    date: `2026-09-0${i + 1}`,
    visitors: [9, 19, 11, 17, 14, 24, 19][i],
    sessions: [10, 20, 12, 18, 15, 25, 20][i],
    bookingsCreated: 1,
    contactClicks: [2, 1, 2, 1, 2, 1, 3][i],
  })),
  sources: [
    {
      source: "yandex_maps",
      sessions: 80,
      trackedLinkOpens: 90,
      bookingsCreated: 5,
      contactClicks: 10,
    },
    {
      source: "direct",
      sessions: 40,
      trackedLinkOpens: 0,
      bookingsCreated: 2,
      contactClicks: 2,
    },
  ],
  sourcesTruncated: false,
  pagesTruncated: false,
  pages: [
    { path: "/", views: 100, contactClicks: 10 },
    { path: "/programs/drawing-for-children", views: 80, contactClicks: 2 },
  ],
  contacts: [
    { target: "phone", clicks: 10 },
    { target: "telegram", clicks: 2 },
  ],
};
const assetDir = "dist/assets";
const cssFiles = (await readdir(assetDir)).filter((name) =>
  name.endsWith(".css"),
);
const css = (
  await Promise.all(
    cssFiles.map((name) => readFile(join(assetDir, name), "utf8")),
  )
).join("\n");
const output = await mkdtemp(join(tmpdir(), "airhop-analytics-visual-"));
const browser = await chromium.launch();
const empty = {
  ...report,
  firstEventAt: null,
  lastEventAt: null,
  pages: [],
  contacts: [],
  sources: [],
  totals: {
    visitors: 0,
    sessions: 0,
    pageViews: 0,
    bookingOpens: 0,
    bookingsCreated: 0,
    contactClicks: 0,
    bookingConversionBps: null,
  },
  funnel: Object.fromEntries(Object.keys(report.funnel).map((key) => [key, 0])),
  siteFunnel: Object.fromEntries(
    Object.keys(report.siteFunnel).map((key) => [key, 0]),
  ),
  days: report.days.map((day) => ({
    ...day,
    visitors: 0,
    sessions: 0,
    bookingsCreated: 0,
    contactClicks: 0,
  })),
};
try {
  for (const [name, width, data] of [
    ["desktop", 1280, report],
    ["mobile", 390, report],
    ["empty", 1280, empty],
  ]) {
    const page = await browser.newPage({ viewport: { width, height: 1000 } });
    const html = renderToStaticMarkup(
      React.createElement(SiteAnalyticsView, { locale: "ru-RU", report: data }),
    );
    await page.setContent(
      `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${css}\nhtml,body { height: auto !important; overflow: visible !important; }</style></head><body><main class="bg-background text-foreground p-4">${html}</main></body></html>`,
    );
    assert.ok(await page.getByTestId("airhop-site-analytics").isVisible());
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      ),
      false,
      `${name}: horizontal overflow`,
    );
    await waitForAnimations(page);
    await page.screenshot({
      path: join(output, `${name}.png`),
      fullPage: true,
    });
    await page.close();
  }
  process.stdout.write(`${output}\n`);
} finally {
  await browser.close();
}
