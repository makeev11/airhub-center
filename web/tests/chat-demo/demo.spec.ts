import { test, expect } from "@playwright/test";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

test("direct link opens usable demo without account and keeps all traffic local", async ({
  page,
  request,
  isMobile,
}, info) => {
  const errors: string[] = [];
  const remote: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("request", (req) => {
    if (new URL(req.url()).hostname !== "127.0.0.1") remote.push(req.url());
  });
  await page.goto("/chat");
  await expect(
    page.getByText("Демо чата Center", { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("heading", { name: "# Команда" })).toBeVisible();
  await expect(
    page.getByText("Привет! Это пробный чат команды", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("Сообщение", { exact: true })
    .fill(`Проверяю демо ${info.project.name}`);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(
    page.getByText(`Проверяю демо ${info.project.name}`, { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Демо-ответ: сообщение получено", { exact: false }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Ветка · 1" }).click();
  await expect(
    page.getByRole("heading", { name: "Ветка обсуждения" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Закрыть ветку" }).click();
  if (isMobile) await page.getByRole("button", { name: "← Чаты" }).click();
  await page.getByRole("button", { name: /● Анна/ }).click();
  await expect(
    page.getByText("А это личная переписка.", { exact: false }),
  ).toBeVisible();
  await page.getByLabel("Выбрать файл").setInputFiles({
    name: "Пробный-файл.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Только демонстрация"),
  });
  await expect(page.locator(".chat-file-chip")).toContainText(
    "Пробный-файл.txt",
  );
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await page
    .getByRole("button", { name: "Открыть файл: Пробный-файл.txt" })
    .last()
    .click();
  await expect(
    page.getByRole("link", { name: "Пробный-файл.txt · Скачать" }).last(),
  ).toBeVisible();
  await expect(
    page.getByText("Демо чата Center", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  const regions = await page
    .locator(".chat-demo-banner, .chat-app")
    .evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().toJSON()),
    );
  expect(regions[1].top).toBeGreaterThanOrEqual(regions[0].bottom);
  await waitForAnimations(page);
  await page.screenshot({ path: info.outputPath("interactive-demo.png") });
  expect(
    (
      await request.get("/__demo__/session", {
        headers: { Origin: "https://foreign.example" },
      })
    ).status(),
  ).toBe(403);
  expect(
    (
      await request.get("/__demo__/session", {
        headers: { Host: "foreign.example" },
      })
    ).status(),
  ).toBe(403);
  expect((await request.get(`/media/${"a".repeat(64)}`)).status()).toBe(401);
  expect((await request.get("/src/chat-demo-main.tsx")).status()).toBe(404);
  expect(errors).toEqual([]);
  expect(remote).toEqual([]);
});

test("Buzz layout keeps channel and thread drafts separate across responsive views", async ({
  page,
  isMobile,
}, info) => {
  await page.goto("/chat");
  await expect(page.getByRole("heading", { name: "# Команда" })).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: info.outputPath("buzz-channel.png") });
  await page.getByLabel("Сообщение", { exact: true }).fill("Черновик канала");
  await page.getByRole("button", { name: "Ветка · 1" }).click();
  const channel = page.getByRole("region", { name: "Канал", exact: true });
  const thread = page.getByRole("region", { name: "Ветка", exact: true });
  await expect(thread).toBeVisible();
  if (isMobile) await expect(channel).toBeHidden();
  else {
    await expect(channel).toBeVisible();
    const mainRect = await channel.boundingBox();
    const threadRect = await thread.boundingBox();
    expect(mainRect).not.toBeNull();
    expect(threadRect?.x).toBeGreaterThanOrEqual(
      (mainRect?.x ?? 0) + (mainRect?.width ?? 0),
    );
  }
  await page
    .getByLabel("Сообщение", { exact: true })
    .fill("Отдельный черновик ветки");
  await expect(
    page.getByLabel("Сообщение в канале", { exact: true }),
  ).toHaveValue("Черновик канала");
  await waitForAnimations(page);
  await page.screenshot({ path: info.outputPath("buzz-thread.png") });
  await page.getByRole("button", { name: "Закрыть ветку" }).click();
  await expect(page.getByLabel("Сообщение", { exact: true })).toHaveValue(
    "Черновик канала",
  );
  await page.getByRole("button", { name: "Ветка · 1" }).click();
  await expect(page.getByLabel("Сообщение", { exact: true })).toHaveValue(
    "Отдельный черновик ветки",
  );
  await page.getByRole("button", { name: "Закрыть ветку" }).click();
  await page.getByLabel("Сообщение", { exact: true }).fill("текст");
  await page.getByLabel("Сообщение", { exact: true }).press("ControlOrMeta+a");
  if (isMobile)
    await page
      .getByRole("button", { name: "Форматирование", exact: true })
      .click();
  await page.getByRole("button", { name: "Жирный текст", exact: true }).click();
  await expect(page.getByLabel("Сообщение", { exact: true })).toHaveValue(
    "**текст**",
  );
  await page.getByLabel("Сообщение", { exact: true }).fill("");
  if (isMobile) await page.getByRole("button", { name: "← Чаты" }).click();
  await page.getByRole("button", { name: "Каналы", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "# Команда", exact: true }),
  ).toBeHidden();
  await page.getByRole("button", { name: "Каналы", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "# Команда", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  if (isMobile) {
    await waitForAnimations(page);
    await page.screenshot({ path: info.outputPath("buzz-channel-list.png") });
  }
});
