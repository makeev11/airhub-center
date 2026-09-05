import { expect, test } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem("airhop.locale.v1", "ru-RU");
  });
  await installMockBridge(page, {
    relayRequiresMembership: true,
    relayRole: "owner",
  });
  await page.goto("/");
});

test("Russian employee settings open localized profiles without excluded Huddle runtime", async ({
  page,
}) => {
  await openSettings(page, "community-members");

  await expect(
    page.getByRole("heading", { name: "Сотрудники", exact: true, level: 1 }),
  ).toBeVisible();
  await expect(page.getByPlaceholder("Найти сотрудника")).toBeVisible();

  await page.getByRole("button", { name: "Открыть профиль: alice" }).click();
  await expect(page).toHaveURL(/#\/\?profile=/);
  await expect(page.getByText("Профиль", { exact: true })).toBeVisible();
  await expect(page.getByText(/useHuddle must be used/)).toHaveCount(0);

  await openSettings(page, "notifications");
  await expect(
    page.getByRole("heading", { name: "Уведомления", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Desktop alerts", { exact: true })).toHaveCount(
    0,
  );
});

test("Russian appearance settings expose center and booking-widget targets", async ({
  page,
}) => {
  await openSettings(page, "appearance");

  await expect(
    page.getByRole("heading", { name: "Внешний вид", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Виджет записи" }).click();
  await expect(page.getByTestId("appearance-widget-settings")).toBeVisible();
  await expect(page.getByTestId("appearance-widget-automatic")).toContainText(
    "Как в Airhop",
  );
  await expect(page.getByTestId("appearance-widget-light")).toContainText(
    "Светлый",
  );
  await expect(page.getByTestId("appearance-widget-dark")).toContainText(
    "Тёмный",
  );
});

test("New Slack is selectable as an opaque Airhop theme", async ({ page }) => {
  await openSettings(page, "appearance");
  await page.getByTestId("appearance-mode-light").click();
  await page.getByTestId("theme-option-new-slack").click();

  await expect(page.locator("html")).toHaveAttribute(
    "data-buzz-theme",
    "new-slack",
  );
  await expect(page.locator("html")).not.toHaveAttribute(
    "data-buzz-translucent",
    "true",
  );
});
