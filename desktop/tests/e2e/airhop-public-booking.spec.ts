import { expect, test, type Locator, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const PUBLIC_BOOKING_PATH = "/#/booking";
const MONDAY_ANIMATION_LABEL = "Понедельник, 10 августа · 18:30–20:00";

async function expectNoHorizontalOverflow(locator: Locator): Promise<void> {
  const overflow = await locator.evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  );
  expect(overflow).toBeLessThanOrEqual(1);
}

async function expectTouchTarget(locator: Locator): Promise<void> {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
  expect(box?.width ?? 0).toBeGreaterThanOrEqual(44);
}

async function expectFooterInFlow(
  flow: Locator,
  footer: Locator,
): Promise<void> {
  await expect(footer).toBeAttached();
  expect(
    await footer.evaluate((element) =>
      Boolean(element.closest('[data-testid="airhop-public-flow"]')),
    ),
  ).toBe(true);
  expect(
    await flow.evaluate(
      (element) =>
        element.lastElementChild?.getAttribute("data-testid") ===
        "airhop-public-footer",
    ),
  ).toBe(true);
}

async function expectFooterAtScrollableEnd(
  flow: Locator,
  footer: Locator,
): Promise<void> {
  await expectFooterInFlow(flow, footer);
  await expect(footer).not.toBeInViewport();
  await flow.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => flow.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(footer).toBeInViewport();
}

async function expectScrollableActions(
  flow: Locator,
  back: Locator,
  forward: Locator,
): Promise<void> {
  const dimensions = await flow.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  await flow.evaluate((element) => {
    element.scrollTop = element.scrollHeight;
  });
  await expect
    .poll(() => flow.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(back).toBeVisible();
  await expect(forward).toBeVisible();
  await expect(back).toBeInViewport();
  await expect(forward).toBeInViewport();
  await expectTouchTarget(back);
  await expectTouchTarget(forward);
}

async function chooseBasics(
  page: Page,
  ageYears: number,
  branchId: string,
): Promise<void> {
  const selectedBranch = page.getByTestId("airhop-public-selected-branch");
  if (!(await selectedBranch.isVisible().catch(() => false))) {
    await page.getByTestId(`airhop-public-branch-${branchId}`).click();
  }
  await page.getByTestId(`airhop-public-age-${ageYears}`).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(
    page.getByRole("heading", { name: "Выберите направление" }),
  ).toBeVisible();
}

async function chooseGroup(page: Page, groupId: string): Promise<void> {
  await page.getByTestId(`airhop-public-group-${groupId}`).click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(
    page.getByRole("heading", { name: "Выберите дату и время" }),
  ).toBeVisible();
}

async function chooseOccurrence(
  page: Page,
  recurrenceRuleId: string,
  originalDate: string,
): Promise<void> {
  await page
    .getByTestId(`airhop-public-occurrence-${recurrenceRuleId}:${originalDate}`)
    .click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(
    page.getByRole("heading", { name: "Контакты для заявки" }),
  ).toBeVisible();
}

async function fillApplicant(
  page: Page,
  childBirthDate: string,
): Promise<void> {
  await page.getByLabel("Имя родителя").fill("Мария Соколова");
  await page.getByLabel("Телефон").fill("+7 999 123-45-67");
  await page.getByLabel("Имя ребёнка").fill("Лев");
  await page.getByLabel("Точная дата рождения ребёнка").fill(childBirthDate);
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await expect(page.getByTestId("airhop-public-preview")).toBeVisible();
}

async function createLimitedBooking(page: Page): Promise<string> {
  await page.goto(PUBLIC_BOOKING_PATH);
  await chooseBasics(page, 5, "kurskaya");
  await chooseGroup(page, "public-limited");
  await chooseOccurrence(page, "public-limited-weekly", "2026-08-10");
  await fillApplicant(page, "2020-08-10");
  await page.getByTestId("airhop-public-submit").click();
  const success = page.getByTestId("airhop-public-success");
  await expect(success).toBeVisible();
  const managementLink = success.getByRole("link", {
    name: "Открыть персональную карточку",
  });
  const href = await managementLink.getAttribute("href");
  expect(href).toBeTruthy();
  return href ?? "";
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("airhop.locale.v1", "ru-RU");
  });
  await page.clock.setFixedTime(new Date("2026-08-04T09:00:00.000Z"));
  await installMockBridge(page);
});

test("standalone public booking completes without employee shell or onboarding", async ({
  page,
}) => {
  await page.goto(PUBLIC_BOOKING_PATH);

  await expect(page.getByTestId("airhop-public-standalone")).toBeVisible();
  await expect(page.getByTestId("airhop-sidebar-nav")).toHaveCount(0);
  await expect(page.getByTestId("app-loading-gate")).toHaveCount(0);
  await expect(page.getByTestId("airhop-public-header")).toContainText(
    "Онлайн-запись · Каляка Маляка",
  );
  await expect(page.getByTestId("airhop-public-header")).not.toContainText(
    "AirHop",
  );
  await expect(
    page.getByText("Запись на пробное занятие", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "Выберите филиал и возраст",
    }),
  ).toBeVisible();
  await expect(page.getByTestId("airhop-public-footer")).toContainText(
    "Работает на Airhop",
  );
  await expect(page.getByTestId("airhop-public-footer")).not.toContainText(
    "Каляка Маляка",
  );
  await expect(
    page.getByText(
      "Точную дату рождения спросим только перед отправкой заявки.",
      { exact: true },
    ),
  ).toHaveCount(0);
  await expect(page.getByTestId("airhop-public-brand-mark")).toHaveAttribute(
    "src",
    "/airhop/mark.png",
  );
  await expect(page.getByTestId("airhop-public-age-5")).toBeVisible();
  await expect(page.getByTestId("airhop-public-age-0")).toHaveAccessibleName(
    "Меньше года",
  );

  await chooseBasics(page, 5, "kurskaya");
  await expect(
    page.getByTestId("airhop-public-group-public-disabled"),
  ).toHaveCount(0);
  await chooseGroup(page, "robotics-junior");
  await expect(
    page.getByTestId(
      "airhop-public-occurrence-robotics-junior-weekly:2026-08-10",
    ),
  ).toContainText("Понедельник, 10 августа · 10:00–11:00");
  await chooseOccurrence(page, "robotics-junior-weekly", "2026-08-10");
  await expect(page.getByLabel("Точная дата рождения ребёнка")).toHaveAttribute(
    "max",
    "2026-08-04",
  );
  await fillApplicant(page, "2020-08-10");

  const preview = page.getByTestId("airhop-public-preview");
  await expect(preview).toContainText("Бесплатно");
  await page.getByTestId("airhop-public-submit").click();
  const success = page.getByTestId("airhop-public-success");
  await expect(success).toContainText("Заявка ожидает подтверждения");

  await page.getByTestId("airhop-contact-channel-telegram").click();
  await expect(success).toContainText("Предпочтительный канал: Telegram");
  await expect(success).toContainText(
    "сообщение в мессенджер ещё не отправлено",
  );

  const managementHref = await success
    .getByRole("link", { name: "Открыть персональную карточку" })
    .getAttribute("href");
  expect(managementHref).toBeTruthy();
  await success.getByRole("link", { name: "Подобрать другое занятие" }).click();
  await expect(
    page.getByRole("heading", { name: "Выберите филиал и возраст" }),
  ).toBeVisible();

  await page.goto(managementHref ?? PUBLIC_BOOKING_PATH);
  const card = page.getByTestId("airhop-public-management-card");
  await expect(card).toBeVisible();
  await expect(page.getByTestId("airhop-public-booking-status")).toHaveText(
    "Ожидает подтверждения",
  );
  await expect(card).toContainText("+79 ••• ••• 45 67");
  await expect(card).not.toContainText("+7 999 123-45-67");
});

test("embedded widget is preselected, closes with Escape and returns focus", async ({
  page,
}) => {
  await page.goto("/#/booking/demo-host");
  const launcher = page.getByTestId("airhop-public-widget-launcher");

  await launcher.click();
  const widget = page.getByTestId("airhop-public-widget");
  await expect(widget).toBeVisible();
  await expect(
    widget.getByRole("heading", { name: "Выберите филиал и возраст" }),
  ).toBeVisible();
  await expect(
    widget.getByTestId("airhop-public-selected-branch"),
  ).toContainText("Академическая");
  await expect(widget.getByTestId("airhop-public-header")).toContainText(
    "Онлайн-запись · Каляка Маляка",
  );
  await expect(widget.getByTestId("airhop-public-header")).not.toContainText(
    "AirHop",
  );
  await expect(widget.getByTestId("airhop-public-footer")).toContainText(
    "Работает на Airhop",
  );
  await page.keyboard.press("Escape");
  await expect(widget).toBeHidden();
  await expect(launcher).toBeFocused();

  await launcher.click();
  await widget.getByTestId("airhop-public-age-8").click();
  await widget.getByRole("button", { name: "Продолжить" }).click();
  await chooseGroup(page, "animation");
  await expect(
    widget.getByTestId("airhop-public-occurrence-animation-weekly:2026-08-10"),
  ).toContainText(MONDAY_ANIMATION_LABEL);
  await chooseOccurrence(page, "animation-weekly", "2026-08-10");
  await fillApplicant(page, "2017-08-10");
  await expect(page.getByTestId("airhop-public-preview")).toContainText(
    "Стоимость:",
  );
  await page.getByTestId("airhop-public-submit").click();
  await expect(page.getByTestId("airhop-public-success")).toContainText(
    "Заявка ожидает подтверждения",
  );
  const hostUrl = page.url();
  await page
    .getByTestId("airhop-public-success")
    .getByRole("button", { name: "Подобрать другое занятие" })
    .click();
  await expect(page).toHaveURL(hostUrl);
  await expect(widget).toBeVisible();
  await expect(
    widget.getByRole("heading", { name: "Выберите филиал и возраст" }),
  ).toBeVisible();
});

test("branch-only links preselect a valid branch and keep it visible across steps", async ({
  page,
}) => {
  await page.goto("/#/booking?branchId=kurskaya");

  await expect(page.getByTestId("airhop-public-selected-branch")).toContainText(
    "Курская",
  );
  await expect(
    page.getByText("Предварительно выбранный вариант недоступен"),
  ).toHaveCount(0);
  await page.getByTestId("airhop-public-age-5").click();
  await page.getByRole("button", { name: "Продолжить" }).click();

  const branchContext = page.getByTestId("airhop-public-branch-context");
  await expect(branchContext).toContainText(
    "Филиал: Курская · ул. Земляной Вал, 27",
  );
  await chooseGroup(page, "robotics-junior");
  await expect(branchContext).toBeVisible();
  await expect(branchContext).toContainText("Курская");

  await branchContext.click();
  await expect(
    page.getByRole("heading", { name: "Выберите филиал и возраст" }),
  ).toBeVisible();
  await expect(page.getByTestId("airhop-public-branch-kurskaya")).toContainText(
    "Курская",
  );
  await expect(
    page.getByTestId("airhop-public-branch-kurskaya"),
  ).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("airhop-public-age-5")).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await page.goto("/#/booking?branchId=archived-branch");
  await expect(page.getByTestId("airhop-public-selected-branch")).toHaveCount(
    0,
  );
  await expect(
    page.getByText("Предварительно выбранный вариант недоступен"),
  ).toBeVisible();
});

test("paid and free offers are both explicit and Back preserves criteria", async ({
  page,
}) => {
  await page.goto(PUBLIC_BOOKING_PATH);
  await chooseBasics(page, 8, "kurskaya");
  await chooseGroup(page, "family-art");
  await expect(
    page.getByTestId("airhop-public-occurrence-family-art-weekly:2026-08-08"),
  ).toContainText("Стоимость:");

  await page.getByRole("button", { name: "Назад" }).click();
  await expect(page.getByTestId("airhop-public-age-8")).toHaveCount(0);
  await chooseGroup(page, "chess-start");
  await expect(
    page.getByTestId("airhop-public-occurrence-chess-start-weekly:2026-08-11"),
  ).toContainText("Бесплатно");
});

test("exact birth date is revalidated before a booking is created", async ({
  page,
}) => {
  await page.goto(PUBLIC_BOOKING_PATH);
  await chooseBasics(page, 8, "akademicheskaya");
  await chooseGroup(page, "animation");
  await chooseOccurrence(page, "animation-weekly", "2026-08-10");
  await fillApplicant(page, "2018-08-11");
  await page.getByTestId("airhop-public-submit").click();

  await expect(
    page.getByText("Точная дата не подходит по возрасту"),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Выберите дату и время" }),
  ).toBeVisible();
  await expect(page.getByTestId("airhop-public-success")).toHaveCount(0);
});

test("last place stays held during transfer request and is freed by cancellation", async ({
  page,
}) => {
  const managementHref = await createLimitedBooking(page);
  const preselectedPath =
    "/#/booking?branchId=kurskaya&groupId=public-limited&birthYear=2020&birthMonth=8";

  await page.goto(preselectedPath);
  await page.reload();
  const bookedOccurrence = page.getByTestId(
    "airhop-public-occurrence-public-limited-weekly:2026-08-10",
  );
  await expect(bookedOccurrence).toBeVisible();
  await expect(bookedOccurrence).toBeDisabled();
  await expect(bookedOccurrence).toContainText("Мест нет");
  await expect(
    page.getByTestId(
      "airhop-public-occurrence-public-limited-weekly:2026-08-17",
    ),
  ).toBeVisible();

  await page.goto(managementHref);
  await page.getByTestId("airhop-public-request-transfer").click();
  await page.getByLabel("Комментарий, необязательно").fill("Удобнее вечером");
  await page.getByTestId("airhop-public-transfer-confirm").click();
  await expect(
    page.getByTestId("airhop-public-transfer-requested"),
  ).toContainText("Заявка остаётся на исходном занятии");

  await page.goto(preselectedPath);
  await expect(bookedOccurrence).toBeVisible();
  await expect(bookedOccurrence).toBeDisabled();
  await expect(bookedOccurrence).toContainText("Мест нет");

  await page.goto(managementHref);
  await page.getByTestId("airhop-public-cancel").click();
  await page.getByTestId("airhop-public-cancel-confirm").click();
  await expect(page.getByTestId("airhop-public-booking-status")).toHaveText(
    "Отменена родителем",
  );
  await expect(
    page.getByTestId("airhop-public-transfer-requested"),
  ).toHaveCount(0);

  await page.goto(preselectedPath);
  await expect(bookedOccurrence).toBeVisible();
  await expect(bookedOccurrence).toBeEnabled();
  await expect(bookedOccurrence).toContainText("Свободных мест: 1");
});

test("booked series edits are explained and exact admin cancellation cascades without revival", async ({
  page,
}) => {
  const managementHref = await createLimitedBooking(page);
  const occurrenceTestId =
    "airhop-public-occurrence-public-limited-weekly:2026-08-10";

  await page.goto("/#/booking/groups");
  const groupCard = page.getByTestId("airhop-group-public-limited");
  await groupCard.getByRole("button", { name: "Редактировать" }).click();
  const groupForm = page.getByTestId("airhop-group-form");
  await groupForm.getByLabel("Понедельник 1").click();
  await groupForm.getByLabel("Вторник 1").click();
  await groupForm.getByRole("button", { name: "Сохранить" }).click();
  const bookedRuleError = page.getByTestId(
    "airhop-group-booked-occurrence-error",
  );
  await expect(groupForm).toBeVisible();
  await expect(bookedRuleError).toContainText("Нельзя изменить эту серию");
  await expect(bookedRuleError).toContainText(
    "Серия уже используется записями",
  );
  await expect(bookedRuleError).not.toContainText("public-limited-weekly");

  await groupForm.getByLabel("Вторник 1").click();
  await groupForm.getByLabel("Понедельник 1").click();
  await groupForm.getByRole("button", { name: "Отмена" }).click();
  await expect(groupForm).toBeHidden();

  await page.goto("/#/booking/schedule");
  await page.getByRole("button", { name: "Следующая неделя" }).click();
  const adminLesson = page.getByTestId(
    "airhop-lesson-public-limited-weekly:2026-08-10",
  );
  await expect(adminLesson).toContainText("Мест нет");
  await adminLesson.click();
  await page.getByTestId("airhop-cancel-lesson").click();
  const cancelDialog = page.getByTestId("airhop-cancel-lesson-dialog");
  await cancelDialog
    .getByRole("button", { name: "Отменить занятие", exact: true })
    .click();
  await expect(page.getByTestId("airhop-lesson-success")).toContainText(
    "Одно занятие отменено",
  );

  await page.goto(managementHref);
  await expect(page.getByTestId("airhop-public-booking-status")).toHaveText(
    "Отменена центром",
  );

  const preselectedPath =
    "/#/booking?branchId=kurskaya&groupId=public-limited&birthYear=2020&birthMonth=8";
  await page.goto(preselectedPath);
  await expect(page.getByTestId(occurrenceTestId)).toHaveCount(0);

  await page.goto("/#/booking/schedule");
  await page.getByRole("button", { name: "Следующая неделя" }).click();
  await page
    .getByTestId("airhop-lesson-public-limited-weekly:2026-08-10")
    .click();
  await page.getByTestId("airhop-restore-lesson").click();
  const restoreDialog = page.getByTestId("airhop-restore-lesson-dialog");
  await restoreDialog
    .getByRole("button", { name: "Вернуть значения серии", exact: true })
    .click();
  await expect(page.getByTestId("airhop-lesson-success")).toContainText(
    "Занятие возвращено к серии",
  );

  await page.goto(managementHref);
  await expect(page.getByTestId("airhop-public-booking-status")).toHaveText(
    "Отменена центром",
  );
  await page.goto(preselectedPath);
  const restoredOccurrence = page.getByTestId(occurrenceTestId);
  await expect(restoredOccurrence).toBeVisible();
  await expect(restoredOccurrence).toBeEnabled();
  await expect(restoredOccurrence).toContainText("Свободных мест: 1");
});

test("invalid management token reveals no booking details", async ({
  page,
}) => {
  await page.goto("/#/booking/manage/not-a-real-token-000000000000");
  const neutralState = page.getByTestId("airhop-public-invalid-token");
  await expect(neutralState).toBeVisible();
  await expect(neutralState).toContainText("Карточка недоступна");
  await expect(neutralState).not.toContainText("Мария Соколова");
});

test("widget purpose and appearance are controlled by AirHop settings", async ({
  page,
}) => {
  await page.goto("/#/booking/settings?section=public-booking");
  await page
    .getByTestId("airhop-settings-public-purpose")
    .selectOption("lesson");
  await page.getByTestId("airhop-settings-public-appearance-dark").click();

  await expect(
    page.getByTestId("airhop-settings-public-appearance-dark"),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByTestId("airhop-settings-public-appearance-light").click();
  await expect(
    page.getByTestId("airhop-settings-public-appearance-light"),
  ).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("airhop-settings-public-appearance-dark").click();

  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByTestId("airhop-settings-saved")).toBeVisible();

  await page.goto(PUBLIC_BOOKING_PATH);
  const flow = page.getByTestId("airhop-public-standalone");
  await expect(flow).toHaveAttribute("data-airhop-appearance", "dark");
  await expect(
    page.getByText("Запись на занятие", { exact: true }),
  ).toBeVisible();
  await chooseBasics(page, 5, "kurskaya");
  await expect(
    page.getByTestId("airhop-public-group-public-disabled"),
  ).toBeVisible();
});

test("public booking stays usable across representative viewport sizes", async ({
  page,
}) => {
  const viewports = [
    { width: 280, height: 653 },
    { width: 320, height: 568 },
    { width: 360, height: 640 },
    { width: 375, height: 667 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 430, height: 932 },
    { width: 768, height: 1024 },
    { width: 1024, height: 768 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ];

  for (const [index, viewport] of viewports.entries()) {
    await page.setViewportSize(viewport);
    await page.emulateMedia({ colorScheme: index % 2 ? "dark" : "light" });

    await page.goto(PUBLIC_BOOKING_PATH);
    const standalone = page.getByTestId("airhop-public-standalone");
    await expect(standalone).toBeVisible();
    await expectNoHorizontalOverflow(standalone);
    await expectNoHorizontalOverflow(
      standalone.getByTestId("airhop-public-flow"),
    );
    await expectTouchTarget(page.getByTestId("airhop-public-age-0"));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);

    await page.goto("/#/booking/demo-host");
    await page.getByTestId("airhop-public-widget-launcher").click();
    const widget = page.getByTestId("airhop-public-widget");
    await expect(widget).toBeVisible();
    await waitForAnimations(page);
    await expectNoHorizontalOverflow(widget);
    await expectNoHorizontalOverflow(widget.getByTestId("airhop-public-flow"));
    await expectTouchTarget(widget.getByTestId("airhop-public-widget-close"));
    await expectTouchTarget(widget.getByTestId("airhop-public-age-0"));
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      ),
    ).toBeLessThanOrEqual(0);
  }
});

for (const viewport of [
  { width: 320, height: 700 },
  { width: 390, height: 844 },
]) {
  for (const colorScheme of ["light", "dark"] as const) {
    test(`public standalone and widget render at ${viewport.width}x${viewport.height} in ${colorScheme}`, async ({
      page,
    }) => {
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme });
      await page.goto(PUBLIC_BOOKING_PATH);
      const standalone = page.getByTestId("airhop-public-standalone");
      await expect(standalone).toBeVisible();
      await chooseBasics(page, 8, "akademicheskaya");
      await chooseGroup(page, "animation");
      await expect(
        standalone.getByRole("heading", { name: "Выберите дату и время" }),
      ).toBeInViewport();
      const standaloneOccurrence = page.getByTestId(
        "airhop-public-occurrence-animation-weekly:2026-08-10",
      );
      await expect(standaloneOccurrence).toContainText(MONDAY_ANIMATION_LABEL);
      await expect(
        page.getByText("Запись на пробное занятие", { exact: true }),
      ).toHaveCount(0);
      await expect(
        standalone.getByTestId("airhop-public-header"),
      ).toContainText("Онлайн-запись · Каляка Маляка");
      await expect(
        standalone.getByTestId("airhop-public-footer"),
      ).toContainText("Работает на Airhop");
      const standaloneBranchContext = standalone.getByTestId(
        "airhop-public-branch-context",
      );
      await expect(standaloneBranchContext).toContainText(
        "Филиал: Академическая · Профсоюзная ул., 17",
      );
      await waitForAnimations(page);
      await page.screenshot({
        path: `test-results/airhop-public-booking/${colorScheme}-${viewport.width}x${viewport.height}-standalone.png`,
      });
      const standaloneOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(standaloneOverflow).toBeLessThanOrEqual(0);
      await expectNoHorizontalOverflow(standalone);
      await expectNoHorizontalOverflow(
        standalone.getByTestId("airhop-public-flow"),
      );
      await expectNoHorizontalOverflow(standaloneBranchContext);
      await expectTouchTarget(standaloneOccurrence);
      await expectFooterAtScrollableEnd(
        standalone.getByTestId("airhop-public-flow"),
        standalone.getByTestId("airhop-public-footer"),
      );
      await expectScrollableActions(
        standalone.getByTestId("airhop-public-flow"),
        standalone.getByRole("button", { name: "Назад" }),
        standalone.getByRole("button", { name: "Продолжить" }),
      );
      await expect(
        standalone.getByTestId("airhop-public-footer"),
      ).toBeInViewport();
      await expect(standaloneBranchContext).toBeInViewport();

      await page.goto("/#/booking/demo-host");
      await page.getByTestId("airhop-public-widget-launcher").click();
      const widget = page.getByTestId("airhop-public-widget");
      await expect(widget).toBeVisible();
      const embedded = widget.getByTestId("airhop-public-embedded");
      await widget.getByTestId("airhop-public-age-8").click();
      await widget.getByRole("button", { name: "Продолжить" }).click();
      await chooseGroup(page, "animation");
      const widgetOccurrence = widget.getByTestId(
        "airhop-public-occurrence-animation-weekly:2026-08-10",
      );
      await expect(
        widget.getByRole("heading", { name: "Выберите дату и время" }),
      ).toBeInViewport();
      await expect(widgetOccurrence).toContainText(MONDAY_ANIMATION_LABEL);
      await expect(widget.getByTestId("airhop-public-header")).toContainText(
        "Онлайн-запись · Каляка Маляка",
      );
      await expect(widget.getByTestId("airhop-public-footer")).toContainText(
        "Работает на Airhop",
      );
      const widgetBranchContext = widget.getByTestId(
        "airhop-public-branch-context",
      );
      await expect(widgetBranchContext).toContainText(
        "Филиал: Академическая · Профсоюзная ул., 17",
      );
      await waitForAnimations(page);
      await page.screenshot({
        path: `test-results/airhop-public-booking/${colorScheme}-${viewport.width}x${viewport.height}-widget.png`,
      });
      const widgetOverflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(widgetOverflow).toBeLessThanOrEqual(0);
      await expectNoHorizontalOverflow(widget);
      await expectNoHorizontalOverflow(embedded);
      await expectNoHorizontalOverflow(
        widget.getByTestId("airhop-public-flow"),
      );
      await expectNoHorizontalOverflow(widgetBranchContext);
      await expectTouchTarget(widgetOccurrence);
      const close = widget.getByTestId("airhop-public-widget-close");
      await expectTouchTarget(close);
      const [closeBox, eyebrowBox] = await Promise.all([
        close.boundingBox(),
        widget.getByTestId("airhop-public-eyebrow").boundingBox(),
      ]);
      expect(closeBox).not.toBeNull();
      expect(eyebrowBox).not.toBeNull();
      const closeOverlapsEyebrow =
        (closeBox?.x ?? 0) < (eyebrowBox?.x ?? 0) + (eyebrowBox?.width ?? 0) &&
        (closeBox?.x ?? 0) + (closeBox?.width ?? 0) > (eyebrowBox?.x ?? 0) &&
        (closeBox?.y ?? 0) < (eyebrowBox?.y ?? 0) + (eyebrowBox?.height ?? 0) &&
        (closeBox?.y ?? 0) + (closeBox?.height ?? 0) > (eyebrowBox?.y ?? 0);
      expect(closeOverlapsEyebrow).toBe(false);
      await expectFooterAtScrollableEnd(
        widget.getByTestId("airhop-public-flow"),
        widget.getByTestId("airhop-public-footer"),
      );
      await expectScrollableActions(
        widget.getByTestId("airhop-public-flow"),
        widget.getByRole("button", { name: "Назад" }),
        widget.getByRole("button", { name: "Продолжить" }),
      );
      await expect(widget.getByTestId("airhop-public-footer")).toBeInViewport();
      await expect(widgetBranchContext).toBeInViewport();
    });
  }
}
