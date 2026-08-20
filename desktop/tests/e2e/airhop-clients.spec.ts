import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

async function createPublicBooking(page: Page): Promise<void> {
  await page.goto("/#/booking");
  await page.getByTestId("airhop-public-branch-kurskaya").click();
  await page.getByTestId("airhop-public-age-5").click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByTestId("airhop-public-group-robotics-junior").click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page
    .getByTestId("airhop-public-occurrence-robotics-junior-weekly:2026-08-10")
    .click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByLabel("Имя родителя").fill("Мария Соколова");
  await page.getByLabel("Телефон").fill("+7 999 123-45-67");
  await page.getByLabel("Имя ребёнка").fill("Лев Соколов");
  await page.getByLabel("Точная дата рождения ребёнка").fill("2020-08-10");
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Продолжить" }).click();
  await page.getByTestId("airhop-public-submit").click();
  await expect(page.getByTestId("airhop-public-success")).toBeVisible();
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  expect(
    await page.evaluate(
      () =>
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth,
    ),
  ).toBeLessThanOrEqual(1);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("airhop.locale.v1", "ru-RU");
  });
  await page.clock.setFixedTime(new Date("2026-08-04T09:00:00.000Z"));
  await installMockBridge(page);
});

test("request queue confirms a public booking and keeps linked client records", async ({
  page,
}) => {
  await createPublicBooking(page);
  await page.goto("/#/booking/requests");

  const row = page.locator('[data-testid^="airhop-request-"]').first();
  await expect(row).toContainText("Лев Соколов");
  await expect(row).toContainText("Мария Соколова");
  await expect(row).toContainText("Робототехника Junior");
  await expect(row).toContainText("Курская");
  await expect(row).toContainText("Ждёт подтверждения");
  await row.getByRole("button", { name: "Подтвердить" }).click();
  const dialog = page.getByTestId("airhop-request-decision-dialog");
  await expect(dialog).toContainText("Лев Соколов");
  await expect(dialog).toContainText("Робототехника Junior");
  await dialog.getByRole("button", { name: "Подтвердить" }).click();
  await expect(page.locator('[data-testid^="airhop-request-"]')).toHaveCount(0);
  await expectNoHorizontalOverflow(page);
});

test("clients directory persists family edits and roster shows active bookings", async ({
  page,
}) => {
  await createPublicBooking(page);
  await page.goto("/#/booking/clients");
  const search = page.getByTestId("airhop-client-search");
  await search.fill("9991234567");
  const family = page.locator('[data-testid^="airhop-family-family-"]').first();
  await expect(family).toContainText("Мария Соколова");
  await expect(family).toContainText("Лев Соколов");
  await family.click();

  await page.getByTestId("airhop-add-child").click();
  const childForm = page.getByTestId("airhop-child-form");
  await childForm.getByTestId("airhop-child-first-name").fill("Анна");
  await childForm.getByTestId("airhop-child-last-name").fill("Соколова");
  await childForm.getByTestId("airhop-child-birth-date").fill("02.03.2022");
  await childForm.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Анна Соколова", { exact: true })).toBeVisible();

  const representative = page
    .locator('[data-testid^="airhop-representative-"]')
    .first();
  await representative.click();
  const representativeForm = page.getByTestId("airhop-representative-form");
  await representativeForm
    .getByTestId("airhop-representative-first-name")
    .fill("Мария");
  await representativeForm
    .getByTestId("airhop-representative-last-name")
    .fill("Иванова");
  await representativeForm.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByText("Мария Иванова", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText("Мария Иванова", { exact: true })).toBeVisible();
  await expect(page.getByText("Анна Соколова", { exact: true })).toBeVisible();

  await page.goto("/#/booking/schedule");
  await page.getByRole("button", { name: "Следующая неделя" }).click();
  await page
    .getByTestId("airhop-lesson-robotics-junior-weekly:2026-08-10")
    .click();
  const roster = page.getByTestId("airhop-lesson-roster");
  await expect(roster).toContainText("Лев Соколов");
  await expect(roster).toContainText("Ожидает подтверждения");
  await expectNoHorizontalOverflow(page);
});

test("new family keeps independent family and member names and uses the Airhop calendar", async ({
  page,
}) => {
  await page.goto("/#/booking/clients");
  await page.getByTestId("airhop-add-family").click();

  const form = page.getByTestId("airhop-family-form");
  await expect(form.getByLabel("Имя представителя")).toBeVisible();
  await expect(form.getByLabel("Фамилия представителя")).toBeVisible();

  await form
    .getByRole("button", { name: "Дата рождения: открыть календарь" })
    .click();
  await expect(page.getByLabel("Месяц", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Год")).toBeVisible();
  await page.keyboard.press("Escape");

  await form.getByLabel("Имя представителя").fill("Мария");
  await form.getByLabel("Фамилия представителя").fill("Соколова");
  await form.getByLabel("Название семьи").fill("Соколовы и Петровы");
  await form.getByLabel("Телефон").fill("+7 999 123-45-67");
  await form.getByLabel("Имя ребёнка").fill("Лев");
  await form.getByLabel("Фамилия ребёнка").fill("Петров");
  await form.getByLabel("Дата рождения", { exact: true }).fill("10.08.2020");
  await form.getByRole("button", { name: "Сохранить" }).click();

  await expect(page).toHaveURL(/#\/booking\/clients\/family-/);
  await expect(
    page.getByText("Соколовы и Петровы", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Мария Соколова", { exact: true })).toBeVisible();
  await expect(page.getByText("Лев Петров", { exact: true })).toBeVisible();
});
