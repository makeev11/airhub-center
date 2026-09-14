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
    principalDirectory: {
      communityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agents: [],
      principals: [],
    },
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

test("Brazilian partner sees communication settings in Portuguese", async ({
  page,
}) => {
  await page.evaluate(() => {
    window.localStorage.setItem("airhop.locale.v1", "pt-BR");
    window.dispatchEvent(
      new CustomEvent("airhop:locale-change", { detail: "pt-BR" }),
    );
  });
  await page.goto("/#/booking/settings?section=channels");

  await expect(
    page.getByRole("heading", {
      name: "Canais de comunicação",
      exact: true,
      level: 1,
    }),
  ).toBeVisible();
  await expect(page.getByRole("navigation")).toContainText("Organização");
  await expect(page.getByRole("navigation")).toContainText("Unidades");
  await expect(page.getByRole("navigation")).toContainText("Grupos");
  await expect(page.getByRole("navigation")).toContainText("Planos");
  await expect(page.getByRole("navigation")).toContainText("Professores");
  await expect(page.getByRole("navigation")).toContainText("Canais");
  await expect(page.getByRole("navigation")).toContainText(
    "Agendamento público",
  );
  await expect(page.getByText(/As conexões estão disponíveis/)).toContainText(
    "Segredos e configurações do servidor não aparecem no modo de visualização.",
  );
  await expect(page.getByText(/Connections are available/)).toHaveCount(0);
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
