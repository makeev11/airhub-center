import { test, expect } from "@playwright/test";
import { RelayFixture, password } from "../chat/fixture";
import { centerVaultKey } from "../../src/features/chat/lib/centers";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

// Mock routes must own the registry/relay requests; worker tooling is Chromium-only.
// The independent chat suite retains the explicit WebKit offline device gate.
test.use({ serviceWorkers: "block" });

test("shared app selects the real relay contract and never shares a vault across Centers", async ({
  page,
}, info) => {
  const relay = new RelayFixture();
  const centerOrigin = "https://demo.airhop.ru";
  await relay.install(page, true, {
    origin: centerOrigin,
    httpBase: "http://127.0.0.1:4192/centers/center-demo",
    vaultKey: centerVaultKey(centerOrigin),
  });
  await page.route("**/chat-centers.json*", (route) =>
    route.fulfill({
      json: [
        { id: "center-demo", name: "Первый Центр", origin: centerOrigin },
        {
          id: "second",
          name: "Второй Центр",
          origin: "https://second.example",
        },
      ],
    }),
  );
  const foreign: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).hostname !== "127.0.0.1")
      foreign.push(request.url());
  });
  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: "Ваш Центр" })).toBeVisible();
  await expect(page.getByText("Демо чата Center", { exact: true })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: /Первый Центр/ }).tap();
  await page.getByLabel("Пароль этого браузера").fill(password);
  await page.getByRole("button", { name: "Открыть чат", exact: true }).tap();
  await page.getByRole("button", { name: "# Команда" }).tap();
  await expect(
    page.getByText("Коллеги, завтра открываемся в 10:00. Всё готово?"),
  ).toBeVisible();
  await page
    .getByLabel("Сообщение", { exact: true })
    .fill("Проверка общего приложения");
  await page.getByRole("button", { name: "Отправить", exact: true }).tap();
  await expect(page.getByLabel("Сообщение", { exact: true })).toHaveValue("");
  await expect(
    page
      .getByLabel("Переписка")
      .getByText("Проверка общего приложения", { exact: true }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: info.outputPath("connected-center.png") });
  // Reload drops the in-memory session; another Center must not reuse its key.
  await page.reload();
  await page.getByRole("button", { name: /Второй Центр/ }).tap();
  await expect(
    page.getByRole("heading", { name: "Команда всегда рядом" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Открыть чат", exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Проверка общего приложения", { exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Выбрать другой Центр" }).tap();
  await page.getByRole("button", { name: /Первый Центр/ }).tap();
  await expect(
    page.getByRole("heading", { name: "С возвращением" }),
  ).toBeVisible();
  expect(foreign).toEqual([]);
});

test("invalid Center registry fails closed without pairing", async ({
  page,
}) => {
  await page.route("**/chat-centers.json*", (route) =>
    route.fulfill({
      json: [
        { id: "../admin", name: "Untrusted", origin: "https://demo.airhop.ru" },
      ],
    }),
  );
  await page.goto("/chat");
  await expect(page.getByRole("alert")).toContainText(
    "Не удалось загрузить Центры",
  );
  await expect(page.getByLabel("Пароль этого браузера")).toHaveCount(0);
});
