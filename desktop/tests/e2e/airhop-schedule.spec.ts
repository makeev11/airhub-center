import { expect, test } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("Buzz AirHop schedule is embedded beside the existing Buzz navigation", async ({
  page,
}) => {
  await page.goto("/#/booking/schedule?demo=airhop");

  await expect(page.getByTestId("airhop-sidebar-nav")).toContainText(
    "Buzz AirHop",
  );
  await expect(page.getByTestId("open-airhop-schedule")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Расписание" })).toBeVisible();
  await expect(page.getByTestId("airhop-schedule-grid")).toBeVisible();
  await expect(page.locator('[data-testid^="airhop-lesson-"]')).toHaveCount(14);
  await expect(page.getByText("Мест нет").first()).toBeVisible();
  await expect(page.getByText("Без ограничений").first()).toBeVisible();
  await expect(page.getByText("Перенесено")).toBeVisible();
  await expect(page.getByText("Отменено")).toBeVisible();

  const branchFilter = page.getByTestId("airhop-branch-filter");
  await expect(branchFilter).toHaveCSS("appearance", "none");
  await branchFilter.selectOption("kurskaya");
  await expect(page.locator('[data-testid^="airhop-lesson-"]')).toHaveCount(7);

  const firstLesson = page.locator('[data-testid^="airhop-lesson-"]').first();
  await firstLesson.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("airhop-lesson-details")).toBeVisible();
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`schedule remains usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/booking/schedule?demo=airhop");
    await expect(page.getByTestId("airhop-schedule-grid-scroll")).toBeVisible();
    await waitForAnimations(page);
    await expect(page.getByTestId("airhop-schedule-grid")).toBeVisible();
  });
}

for (const theme of ["buzz", "buzz-dark", "github-light"]) {
  test(`schedule uses semantic surfaces in ${theme}`, async ({ page }) => {
    await page.addInitScript((selectedTheme) => {
      window.localStorage.setItem("buzz-theme", selectedTheme);
    }, theme);
    await page.goto("/#/booking/schedule?demo=airhop");
    await expect(page.getByTestId("airhop-schedule-grid")).toBeVisible();
    await waitForAnimations(page);
    await expect(
      page.getByRole("heading", { name: "Расписание" }),
    ).toBeVisible();
  });
}
