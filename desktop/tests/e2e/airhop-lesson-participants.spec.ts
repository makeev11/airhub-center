import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

test.beforeEach(async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-04T09:00:00.000Z"));
  await installMockBridge(page);
});

test("staff adds new and existing children to lessons and records attendance", async ({
  page,
}) => {
  await page.goto("/#/booking/settings");
  await page.getByTestId("airhop-settings-single-visits").click();
  await page.getByRole("button", { name: "Сохранить" }).click();

  await page.getByTestId("open-airhop-schedule").click();
  await page.setViewportSize({ width: 351, height: 704 });
  const firstLesson = page.getByTestId(
    "airhop-lesson-robotics-junior-weekly:2026-08-03",
  );
  await firstLesson.click();
  await page.getByTestId("airhop-add-participant").click();

  let dialog = page.getByTestId("airhop-lesson-participant-dialog");
  await expect(
    dialog.getByTestId("airhop-participant-visit-kind"),
  ).toBeVisible();
  await dialog.getByTestId("airhop-participant-new-mode").click();
  await dialog.getByTestId("airhop-participant-parent-name").fill("Ирина");
  await dialog.getByTestId("airhop-participant-phone").fill("+7 999 123-45-67");
  await dialog.getByTestId("airhop-participant-child-name").fill("Миша");
  await dialog.getByTestId("airhop-participant-birth-date").fill("2020-08-03");
  await dialog
    .getByTestId("airhop-participant-visit-kind")
    .selectOption("single");
  await dialog.getByRole("button", { name: "Добавить" }).click();

  let roster = page.getByTestId("airhop-lesson-roster");
  await expect(roster).toContainText("Миша");
  await expect(roster).not.toContainText("Ожидает подтверждения");
  await expect(page.getByTestId("airhop-lesson-details")).toContainText(
    "1 из 8 занято",
  );

  const present = roster.getByRole("button", {
    name: "Пришёл",
    exact: true,
  });
  await present.click();
  await expect(present).toHaveAttribute("aria-pressed", "true");
  await page.reload();
  await firstLesson.click();
  roster = page.getByTestId("airhop-lesson-roster");
  await expect(
    roster.getByRole("button", { name: "Пришёл", exact: true }),
  ).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: "Close" }).click();
  await page.goto("/#/booking/requests");
  await expect(page.getByRole("heading", { name: "Заявки" })).toBeVisible();
  await expect(page.getByText("Миша", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Все", exact: true }).click();
  await expect(page.getByText("Миша", { exact: true })).toHaveCount(0);

  await page.goto("/#/booking/schedule");
  await page.getByRole("button", { name: "Следующая неделя" }).click();
  const secondLesson = page.getByTestId(
    "airhop-lesson-robotics-junior-weekly:2026-08-10",
  );
  await secondLesson.click();
  await page.getByTestId("airhop-add-participant").click();
  dialog = page.getByTestId("airhop-lesson-participant-dialog");
  await dialog.getByTestId("airhop-participant-existing-mode").click();
  await dialog
    .getByPlaceholder("Имя ребёнка, родителя или телефон")
    .fill("Миша");
  await dialog.getByRole("button", { name: /Миша/ }).click();
  await dialog
    .getByTestId("airhop-participant-visit-kind")
    .selectOption("trial");
  await dialog.getByRole("button", { name: "Добавить" }).click();

  await expect(page.getByTestId("airhop-lesson-roster")).toContainText("Миша");
  await expect(page.getByTestId("airhop-lesson-details")).toContainText(
    "1 из 8 занято",
  );
});

test("participant dialog stays within a narrow phone viewport", async ({
  page,
}) => {
  await page.setViewportSize({ width: 351, height: 704 });
  await page.goto("/#/booking/schedule");
  await page
    .getByTestId("airhop-lesson-robotics-junior-weekly:2026-08-03")
    .click();
  await page.getByTestId("airhop-add-participant").click();

  const dialog = page.getByTestId("airhop-lesson-participant-dialog");
  await expect(
    dialog.getByTestId("airhop-participant-visit-kind-label"),
  ).toHaveText("Пробное");
  await expect(dialog.getByTestId("airhop-participant-visit-kind")).toHaveCount(
    0,
  );
  const dimensions = await dialog.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
  await expect(dialog.getByRole("button", { name: "Добавить" })).toBeVisible();
});
