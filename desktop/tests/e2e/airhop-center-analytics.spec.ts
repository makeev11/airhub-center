import { expect, test } from "@playwright/test";
import { createInitialDemoBookingWorkspace } from "../../src/features/booking/data/demoBookingRepository";
import { buildCenterAnalyticsPreview } from "../../src/features/booking/lib/centerAnalytics";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

test("server analytics keeps the primary report available and fails closed on primary errors", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("airhop.locale.v1", "ru-RU");
    (
      window as Window & { __AIRHOP_E2E_STAFF_SERVER__?: boolean }
    ).__AIRHOP_E2E_STAFF_SERVER__ = true;
  });
  await installMockBridge(page);
  const now = new Date("2026-09-07T23:30:00Z");
  const workspace = createInitialDemoBookingWorkspace("Pacific/Kiritimati");
  let fail = false;
  let releaseExtras = () => {};
  const extrasGate = new Promise<void>((resolve) => {
    releaseExtras = resolve;
  });
  const reads: string[] = [];
  await page.route("**/api/airhop/staff/v1/**", async (route) => {
    const url = new URL(route.request().url());
    reads.push(url.pathname + url.search);
    if (url.searchParams.get("view") !== "center") {
      await extrasGate;
      await route.fulfill({
        status: 503,
        json: { error: "Test optional report unavailable" },
      });
      return;
    }
    if (fail) {
      await route.fulfill({
        status: 503,
        json: { error: "Test report unavailable" },
      });
      return;
    }
    const report = buildCenterAnalyticsPreview(
      workspace,
      Number(url.searchParams.get("days")),
      url.searchParams.get("until") === "yesterday" ? "yesterday" : "today",
      now,
    );
    // Explicitly synthetic UI fixture: real HTTP contract, not a business claim.
    report.cohort.bookings = 7;
    report.cohort.confirmed = 5;
    report.cohort.attended = 3;
    report.cohort.enrollments = 2;
    report.cohort.payingEnrollments = 1;
    report.coverage.attributedBookings = 4;
    report.coverage.unattributedBookings = 3;
    report.students.active = 4;
    report.students.newEnrollments = 2;
    report.students.repeatPayingEnrollments = 1;
    report.attendance = { present: 3, absent: 1, children: 3, lessons: 2 };
    report.sources = [
      {
        source: "yandex_maps",
        trackingLinkId: "synthetic-map",
        linkName: "Тестовая ссылка на картах",
        bookings: 4,
        confirmed: 3,
        attended: 2,
        enrollments: 1,
        payingEnrollments: 1,
        money: [{ currency: "EUR", netMinor: 80000 }],
      },
      {
        source: "phone",
        trackingLinkId: null,
        linkName: null,
        bookings: 3,
        confirmed: 2,
        attended: 1,
        enrollments: 1,
        payingEnrollments: 0,
        money: [],
      },
    ];
    report.money = [
      {
        currency: "EUR",
        receiptsMinor: 100000,
        refundsMinor: 20000,
        outstandingMinor: 50000,
        overdueMinor: 10000,
      },
      {
        currency: "RUB",
        receiptsMinor: 0,
        refundsMinor: 300000,
        outstandingMinor: 0,
        overdueMinor: 0,
      },
    ];
    report.days[0].bookings = 7;
    report.days[0].present = 3;
    await route.fulfill({
      json: { organization: workspace.organization, analytics: report },
    });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/#/booking/analytics");
  await expect(page.getByTestId("airhop-center-overview")).toBeVisible();
  await expect(
    page.getByText("Обзор готов. Дополнительные отчёты ещё загружаются."),
  ).toBeVisible();
  releaseExtras();
  await expect(
    page.getByText(
      "Обзор центра загружен, но часть дополнительных отчётов недоступна.",
      { exact: false },
    ),
  ).toBeVisible();
  await expect(
    page.getByText("Демонстрационные данные браузера.", { exact: false }),
  ).toHaveCount(0);
  await expect(
    page.getByText("7 сент. 2026 г.", { exact: true }),
  ).toBeVisible();
  expect(reads).toContain(
    "/api/airhop/staff/v1/booking-funnel-analytics?view=center&days=1&until=yesterday",
  );
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/center-analytics-server-partial.png",
  });
  await page.getByRole("button", { name: "30 дн.", exact: true }).click();
  await expect(
    page.getByText("Сегодняшний день ещё не завершён", { exact: false }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/center-analytics-server-trend.png",
  });
  await page.getByRole("button", { name: "Привлечение", exact: true }).click();
  const sources = page.getByTestId("airhop-center-sources");
  await expect(sources.getByRole("row")).toHaveCount(3);
  await sources.getByLabel("Источник в таблице").selectOption("yandex_maps");
  await expect(sources.getByRole("row")).toHaveCount(2);
  await expect(
    sources.getByRole("cell", { name: "Телефон", exact: true }),
  ).toHaveCount(0);
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/center-analytics-server-sources.png",
  });
  await page.getByRole("button", { name: "Деньги", exact: true }).click();
  const money = page.getByTestId("airhop-center-money");
  await expect(
    money.getByRole("heading", { name: "EUR", exact: true }),
  ).toBeVisible();
  await expect(
    money.getByRole("heading", { name: "RUB", exact: true }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/center-analytics-server-money.png",
  });
  fail = true;
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("airhop-center-overview")).toHaveCount(0);
  await expect(
    page.getByText("Демонстрационные данные браузера.", { exact: false }),
  ).toHaveCount(0);
});

test("a late analytics response cannot replace the newer selected period", async ({
  page,
}) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("airhop.locale.v1", "ru-RU");
    (
      window as Window & { __AIRHOP_E2E_STAFF_SERVER__?: boolean }
    ).__AIRHOP_E2E_STAFF_SERVER__ = true;
  });
  await installMockBridge(page);
  const workspace = createInitialDemoBookingWorkspace("Pacific/Kiritimati");
  let releaseSevenDays = () => {};
  const sevenDaysGate = new Promise<void>((resolve) => {
    releaseSevenDays = resolve;
  });
  await page.route("**/api/airhop/staff/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") !== "center") {
      await route.fulfill({
        status: 503,
        json: { error: "Optional report unavailable" },
      });
      return;
    }
    const days = Number(url.searchParams.get("days"));
    if (days === 7) await sevenDaysGate;
    await route.fulfill({
      json: {
        organization: workspace.organization,
        analytics: buildCenterAnalyticsPreview(
          workspace,
          days,
          url.searchParams.get("until") === "yesterday" ? "yesterday" : "today",
          new Date("2026-09-07T23:30:00Z"),
        ),
      },
    });
  });
  await page.goto("/#/booking/analytics");
  await expect(page.getByTestId("airhop-center-overview")).toBeVisible();
  await page.getByRole("button", { name: "7 дн.", exact: true }).click();
  await expect(
    page.getByText("Обновляю данные. Ниже пока предыдущий снимок."),
  ).toBeVisible();
  await page.getByRole("button", { name: "30 дн.", exact: true }).click();
  const latestDate = page.getByText("10 авг. 2026 г. — 8 сент. 2026 г.", {
    exact: true,
  });
  await expect(latestDate).toBeVisible();
  const lateResponse = page.waitForResponse((response) =>
    response.url().includes("view=center&days=7&"),
  );
  releaseSevenDays();
  await lateResponse;
  await waitForAnimations(page);
  await expect(latestDate).toBeVisible();
  await expect(
    page.getByRole("button", { name: "30 дн.", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");
});

test("consultations show real statuses, question drilldowns, empty and unavailable states", async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem("airhop.locale.v1", "ru-RU");
    (
      window as Window & { __AIRHOP_E2E_STAFF_SERVER__?: boolean }
    ).__AIRHOP_E2E_STAFF_SERVER__ = true;
  });
  await installMockBridge(page);
  const now = new Date("2026-09-10T12:00:00Z");
  const workspace = createInitialDemoBookingWorkspace("Europe/Moscow");
  let mode: "populated" | "empty" | "unavailable" = "populated";
  const questionKeys = [
    "age",
    "branch",
    "activity",
    "time",
    "contact",
    "confirmation",
    "other",
  ] as const;
  const stageKeys = [
    "started",
    "group",
    "time",
    "details",
    "confirmation",
    "booked",
  ] as const;
  await page.route("**/api/airhop/staff/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("view") !== "center") {
      await route.fulfill({
        status: 503,
        json: { error: "Optional test service" },
      });
      return;
    }
    const report = buildCenterAnalyticsPreview(
      workspace,
      Number(url.searchParams.get("days") ?? 7),
      url.searchParams.get("until") === "yesterday" ? "yesterday" : "today",
      now,
    );
    if (mode !== "unavailable") {
      const populated = mode === "populated";
      report.consultations = {
        version: 1,
        generatedAt: now.toISOString(),
        quietHours: 48,
        learning: {
          windowDays: 7,
          comparison: "observational",
          metric: "booking_created_within_7_days",
          scope: "accessible_channels",
          eligible: populated ? 4 : 0,
          booked: populated ? 1 : 0,
          pending: populated ? 1 : 0,
          mixed: populated ? 1 : 0,
          unattributed: 0,
          versionsTruncated: false,
          versions: populated
            ? [
                {
                  configuration: {
                    deploymentVersion: 2,
                    personaRevision: "test-script-v2",
                  },
                  firstStartedAt: "2026-09-01T10:00:00Z",
                  lastStartedAt: "2026-09-10T10:00:00Z",
                  started: 4,
                  eligible: 3,
                  booked: 1,
                  pending: 1,
                  handedOff: 1,
                  declined: 0,
                  draftCancelled: 0,
                  bookingCancelledNow: 0,
                  bookingRejectedNow: 0,
                  segments: [
                    {
                      branchName: "Тестовый филиал",
                      provider: "telegram",
                      familyLinked: false,
                      eligible: 3,
                      booked: 1,
                    },
                  ],
                },
              ]
            : [],
        },
        untrackedConversations: 3,
        itemsTruncated: false,
        summary: {
          started: populated ? 5 : 0,
          booked: populated ? 1 : 0,
          waiting: populated ? 1 : 0,
          quiet: populated ? 1 : 0,
          agentWaiting: populated ? 1 : 0,
          withStaff: populated ? 1 : 0,
          declined: 0,
          cancelled: 0,
          delivery: 0,
          ongoing: 0,
        },
        stages: stageKeys.map((key, index) => ({
          key,
          reached: populated ? [5, 4, 3, 2, 1, 1][index] : 0,
        })),
        questions: questionKeys.map((key) => ({
          key,
          asked: populated ? (key === "time" ? 3 : 1) : 0,
          answered: populated ? (key === "time" ? 2 : 0) : 0,
          waiting: populated && key === "contact" ? 1 : 0,
          quiet: populated && key === "time" ? 1 : 0,
        })),
        items: populated
          ? (
              [
                "quiet",
                "agent_waiting",
                "with_staff",
                "waiting",
                "booked",
              ] as const
            ).map((status, index) => ({
              id: `10000000-0000-4000-8000-00000000000${index}`,
              conversationId: `20000000-0000-4000-8000-00000000000${index}`,
              channelId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
              rootEventId: "a".repeat(64),
              title: [
                "Тест: выбор времени",
                "Тест: ответ за агентом",
                "Тест: передача сотруднику",
                "Тест: ждём контакты",
                "Тест: заявка создана",
              ][index],
              branchName: "Тестовый филиал",
              connectionName: "Тестовый Telegram",
              provider: "telegram",
              startedAt: "2026-09-07T12:00:00Z",
              status,
              question: status === "quiet" ? "time" : "contact",
              questionEventId: "b".repeat(64),
              waitingSince:
                status === "quiet"
                  ? "2026-09-07T12:00:00Z"
                  : status === "waiting"
                    ? "2026-09-10T10:00:00Z"
                    : null,
              bookingId:
                status === "booked"
                  ? "30000000-0000-4000-8000-000000000000"
                  : null,
            }))
          : [],
      };
    }
    await route.fulfill({
      json: { organization: workspace.organization, analytics: report },
    });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/#/booking/analytics");
  await page.getByRole("button", { name: "30 дн.", exact: true }).click();
  await page.getByRole("button", { name: "Консультации", exact: true }).click();
  const view = page.getByTestId("airhop-consultations");
  await expect(
    view.getByRole("heading", { name: "Результат работы Гермеса" }),
  ).toBeVisible();
  await expect(
    view.getByTestId("consultation-learning").getByText(/^25\s*%$/),
  ).toBeVisible();
  await expect(
    view.getByRole("heading", { name: "Путь к записи" }),
  ).not.toBeVisible();
  await waitForAnimations(page);
  await view.screenshot({
    path: "test-results/consultation-owner-overview.png",
  });
  await view.getByText("Как меняются результаты", { exact: true }).click();
  await expect(
    view.getByText("Версия 2 · test-script-v2", { exact: true }),
  ).toBeVisible();
  await expect(
    view.getByText(/Исключены из сравнения версий: 1/),
  ).toBeVisible();
  await view.getByText("Подробнее: этапы и диалоги", { exact: true }).click();
  await expect(
    view.getByRole("heading", { name: "Путь к записи" }),
  ).toBeVisible();
  await expect(
    view.getByText("Тест: выбор времени", { exact: true }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/consultations-desktop.png",
    fullPage: true,
  });
  await view
    .getByRole("button", {
      name: "Дата и время: Нет ответа более 48 ч — 1",
      exact: true,
    })
    .click();
  const conversations = page.getByTestId("consultation-conversations");
  await expect(conversations.getByRole("link")).toHaveCount(1);
  await expect(conversations.getByRole("link")).toHaveAttribute(
    "href",
    /channels\/9a1657ac.*thread=aaaa/,
  );
  await expect(
    conversations.getByText("Без ответа 72 ч", { exact: true }),
  ).toBeVisible();
  await expect(
    conversations.getByText("Тест: ждём контакты", { exact: true }),
  ).toHaveCount(0);
  await conversations.getByRole("button", { name: "Сбросить" }).click();
  await expect(conversations.getByRole("link")).toHaveCount(5);
  await view
    .getByRole("button", { name: "Ответ за агентом · 1", exact: true })
    .click();
  await expect(conversations.getByRole("link")).toHaveText(
    "Тест: ответ за агентом",
  );
  await conversations.getByRole("button", { name: "Сбросить" }).click();
  await page.setViewportSize({ width: 800, height: 950 });
  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/consultations-narrow.png",
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  mode = "empty";
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(
    page.getByText("Здесь появится путь от вопроса до записи", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Тест: выбор времени", { exact: true }),
  ).toHaveCount(0);
  mode = "unavailable";
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await expect(page.getByTestId("consultations-unavailable")).toBeVisible();
  await page.getByRole("button", { name: "Обзор", exact: true }).click();
  await expect(page.getByTestId("airhop-center-overview")).toBeVisible();
});
