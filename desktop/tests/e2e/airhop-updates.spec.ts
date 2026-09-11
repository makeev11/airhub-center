import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";

async function commands(page: Page) {
  return page.evaluate(
    () =>
      (window as Window & { __BUZZ_E2E_COMMANDS__?: string[] })
        .__BUZZ_E2E_COMMANDS__ ?? [],
  );
}
async function setUpdateMock(page: Page, values: Record<string, unknown>) {
  await page.evaluate((patch) => {
    const target = window as Window & {
      __BUZZ_E2E__?: { mock?: Record<string, unknown> };
    };
    Object.assign(target.__BUZZ_E2E__?.mock ?? {}, patch);
  }, values);
}
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() =>
    localStorage.setItem("airhop.locale.v1", "ru-RU"),
  );
});

test("new release offers an update at startup and installs only on explicit click", async ({
  page,
}) => {
  await installMockBridge(page, {
    updateAvailable: true,
    updateVersion: "0.5.14",
  });
  await page.goto("/");
  await expect(page.getByTestId("sidebar-update-card")).toBeVisible();
  expect(await commands(page)).toContain("plugin:updater|download");
  expect(await commands(page)).not.toContain("plugin:updater|install");
  expect(await commands(page)).not.toContain("plugin:process|restart");
  await page.getByTestId("sidebar-update-now").click();
  await expect
    .poll(() => commands(page))
    .toEqual(
      expect.arrayContaining([
        "plugin:updater|install",
        "plugin:process|restart",
      ]),
    );
  const calls = await commands(page);
  expect(
    calls.filter((call) => call === "plugin:updater|install"),
  ).toHaveLength(1);
  expect(calls.indexOf("plugin:updater|download")).toBeLessThan(
    calls.indexOf("plugin:updater|install"),
  );
  expect(calls.indexOf("plugin:updater|install")).toBeLessThan(
    calls.indexOf("plugin:process|restart"),
  );
});

test("current release stays quiet and manual check reports up to date", async ({
  page,
}) => {
  await installMockBridge(page);
  await page.goto("/");
  await openSettings(page, "updates");
  await page.getByRole("button", { name: "Проверить обновления" }).click();
  await expect(
    page.getByText("У вас установлена последняя версия."),
  ).toBeVisible();
  expect(await commands(page)).not.toContain("plugin:updater|download");
  expect(await commands(page)).not.toContain("plugin:updater|install");
});

test("network failure is retryable and is never reported as latest version", async ({
  page,
}) => {
  await installMockBridge(page, { updateCheckError: "Network unavailable" });
  await page.goto("/");
  await openSettings(page, "updates");
  await page.getByRole("button", { name: "Проверить обновления" }).click();
  await expect(
    page.getByText("Не удалось обновить: Network unavailable"),
  ).toBeVisible();
  await expect(
    page.getByText("У вас установлена последняя версия."),
  ).toHaveCount(0);
  await setUpdateMock(page, {
    updateCheckError: undefined,
    updateAvailable: true,
    updateVersion: "0.5.14",
  });
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Установить сейчас" }),
  ).toBeVisible();
  expect(await commands(page)).not.toContain("plugin:updater|install");
});

test("failed signature or download cannot install or restart the app", async ({
  page,
}) => {
  await installMockBridge(page, {
    updateAvailable: true,
    updateDownloadError: "Signature verification failed",
  });
  await page.goto("/");
  await openSettings(page, "updates");
  await expect(
    page.getByText("Не удалось обновить: Signature verification failed"),
  ).toBeVisible();
  expect(await commands(page)).not.toContain("plugin:updater|install");
  expect(await commands(page)).not.toContain("plugin:process|restart");
  await setUpdateMock(page, { updateDownloadError: undefined });
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Установить сейчас" }),
  ).toBeVisible();
});

test("unsupported package links to AirHop rather than upstream Buzz", async ({
  page,
}) => {
  await installMockBridge(page, {
    updateAvailable: true,
    autoUpdateSupported: false,
  });
  await page.goto("/");
  await page.getByTestId("sidebar-update-download-github").click();
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
          "get_e2e_opened_external_urls",
          {},
        ),
      ),
    )
    .toEqual(["https://github.com/makeev11/airhub-center/releases"]);
  expect(await commands(page)).not.toContain("plugin:updater|download");
  expect(await commands(page)).not.toContain("plugin:updater|install");
});

test("install failure never restarts and keeps a visible error", async ({
  page,
}) => {
  await installMockBridge(page, {
    updateAvailable: true,
    updateInstallError: "Install failed",
  });
  await page.goto("/");
  await openSettings(page, "updates");
  await page.getByRole("button", { name: "Установить сейчас" }).click();
  await expect(
    page.getByText("Не удалось обновить: Install failed"),
  ).toBeVisible();
  expect(await commands(page)).not.toContain("plugin:process|restart");
});
