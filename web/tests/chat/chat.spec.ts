import { expect, test } from "@playwright/test";
import {
  RelayFixture,
  employee,
  message,
  origin,
  password,
  unlock,
} from "./fixture";
import { VAULT_KEY } from "../../src/features/chat/lib/identity";
import { sign } from "../../src/features/chat/lib/identity";
import {
  makeReadState,
  readContexts,
} from "../../src/features/chat/lib/read-state";
import { colleague } from "./fixture";
import { verifyEvent } from "nostr-tools/pure";
import { waitForAnimations } from "../../../desktop/tests/helpers/animations";

test("same channels and DMs, live messages, replies, search, editing, reactions and deletion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const relay = new RelayFixture();
  await relay.install(page);
  await unlock(page);
  await expect(page.getByRole("button", { name: /● Мария/ })).toHaveCount(1);
  await page.getByRole("button", { name: "# Команда" }).click();
  await expect(
    page.getByText("Коллеги, завтра открываемся в 10:00. Всё готово?"),
  ).toBeVisible();
  relay.add(
    message(
      "Новое сообщение от коллеги",
      "team",
      undefined,
      Math.floor(Date.now() / 1000),
    ),
  );
  await expect(page.getByText("Новое сообщение от коллеги")).toBeVisible();
  const row = page.locator("article").filter({ hasText: "Коллеги, завтра" });
  await row.getByRole("button", { name: "Ветка · 1" }).click();
  await expect(page.getByText("Да, оборудование проверено.")).toBeVisible();
  await page
    .getByLabel("Сообщение", { exact: true })
    .fill("Отлично, до завтра!");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  const sent = page
    .locator("article")
    .filter({ hasText: "Отлично, до завтра!" });
  await expect(sent).toBeVisible();
  await sent.getByRole("button", { name: "Поставить 👍" }).click();
  await expect(sent.getByRole("button", { name: "👍 1" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await sent.getByRole("button", { name: "Изменить", exact: true }).click();
  await page
    .getByLabel("Редактировать сообщение")
    .fill("Отлично, буду к десяти!");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(page.getByText("Отлично, буду к десяти!")).toBeVisible();
  await page.getByRole("button", { name: "Закрыть ветку" }).click();
  await page.getByRole("button", { name: "Поиск по чату" }).click();
  await page.getByLabel("Поиск в переписке").fill("открываемся");
  await page.getByRole("button", { name: "Найти", exact: true }).click();
  await expect(page.getByText("Найдено: 1.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Сбросить" }).click();
  await page
    .getByLabel("Сообщение", { exact: true })
    .fill("Удаляемое сообщение");
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  const removable = page
    .locator("article")
    .filter({ hasText: "Удаляемое сообщение" });
  await removable.getByRole("button", { name: "Удалить", exact: true }).click();
  await removable.getByRole("button", { name: "Да, удалить" }).click();
  await expect(page.getByText("Сообщение удалено")).toBeVisible();
  await expect(
    page.getByText("Фоновые уведомления пока недоступны", { exact: false }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  expect(
    relay.sent.some(
      (event) =>
        event.kind === 9 &&
        event.tags.some((tag) => tag[0] === "e" && tag[3] === "reply"),
    ),
  ).toBe(true);
});

test("dropped ACK retries without duplicate and drafts survive conversation switch", async ({
  page,
}) => {
  const relay = new RelayFixture();
  await relay.install(page);
  await unlock(page);
  await page.getByRole("button", { name: "# Команда" }).click();
  await page.getByLabel("Сообщение", { exact: true }).fill("Черновик команды");
  await page.getByRole("button", { name: "← Чаты" }).click();
  await page.getByRole("button", { name: "# Смена" }).click();
  await page.getByRole("button", { name: "← Чаты" }).click();
  await page.getByRole("button", { name: "# Команда" }).click();
  await expect(page.getByLabel("Сообщение", { exact: true })).toHaveValue(
    "Черновик команды",
  );
  relay.dropNextMessageAck = true;
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Повторить отправку" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Повторить отправку" }).click();
  await expect(page.getByLabel("Сообщение", { exact: true })).toHaveValue("");
  const sends = relay.sent.filter(
    (event) => event.kind === 9 && event.content === "Черновик команды",
  );
  expect(sends).toHaveLength(2);
  expect(sends[0].id).toBe(sends[1].id);
  await expect(
    page.locator("article").filter({ hasText: "Черновик команды" }),
  ).toHaveCount(1);
});

test("desktop-compatible pairing requires local SAS confirmation and stores encrypted credentials", async ({
  page,
}) => {
  const relay = new RelayFixture();
  await relay.install(page, false);
  await page.goto("/chat");
  await page.getByLabel("Пароль этого браузера").fill(password);
  await page.getByLabel("Повторите пароль").fill(password);
  await page
    .getByLabel("Код подключения", { exact: true })
    .fill(relay.pairingCode());
  await page
    .getByRole("button", { name: "Подключить устройство", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Да, цифры совпадают" }),
  ).toBeVisible();
  await expect.poll(() => relay.sas).not.toBe("");
  await expect(page.locator(".chat-sas")).toHaveText(relay.sas);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), VAULT_KEY),
  ).toBeNull();
  await page.getByRole("button", { name: "Да, цифры совпадают" }).click();
  await expect(page.getByRole("button", { name: "# Команда" })).toBeVisible();
  const stored = await page.evaluate(
    (key) => localStorage.getItem(key),
    VAULT_KEY,
  );
  expect(stored).not.toContain("nsec");
  expect(stored).not.toContain(Buffer.from(employee.secret).toString("hex"));
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "С возвращением" }),
  ).toBeVisible();
  await page.getByLabel("Пароль этого браузера").fill("wrong password");
  await page.getByRole("button", { name: "Открыть чат", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Проверьте пароль");
});

test("denied account exposes no channels or messages", async ({ page }) => {
  const relay = new RelayFixture();
  relay.denyAuth = true;
  await relay.install(page);
  await page.goto("/chat");
  await page.getByLabel("Пароль этого браузера").fill(password);
  await page.getByRole("button", { name: "Открыть чат", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Доступ отклонён");
  await expect(page.getByRole("button", { name: "# Команда" })).toHaveCount(0);
  expect(relay.sent).toHaveLength(0);
});

test("attachments use signed auth and HTML in messages stays inert", async ({
  page,
}) => {
  const relay = new RelayFixture();
  await relay.install(page);
  const hash = "ab".repeat(32);
  let authorized = false;
  await page.route(`${origin}/media/${hash}.txt`, (route) => {
    authorized =
      route.request().headers().authorization?.startsWith("Nostr ") ?? false;
    return route.fulfill({ body: "fixture text", contentType: "text/plain" });
  });
  relay.events.push(
    message(
      `[Инструкция.txt](${origin}/media/${hash}.txt)\n\n<script>window.pwned=true</script><img src=x onerror=alert(1)>`,
    ),
  );
  await unlock(page);
  await page.getByRole("button", { name: "# Команда" }).click();
  await page
    .getByRole("button", { name: "Открыть файл: Инструкция.txt" })
    .click();
  await expect(
    page.getByRole("link", { name: "Инструкция.txt · Скачать" }),
  ).toBeVisible();
  expect(authorized).toBe(true);
  expect(await page.evaluate(() => "pwned" in window)).toBe(false);
});

test("native e-only reaction arrives live and collapsed replies remain unread", async ({
  page,
}) => {
  const relay = new RelayFixture();
  await relay.install(page);
  await unlock(page);
  await page.getByRole("button", { name: "# Команда" }).click();
  const root = relay.events.find((event) =>
    event.content.startsWith("Коллеги,"),
  );
  const reply = relay.events.find(
    (event) => event.content === "Да, оборудование проверено.",
  );
  expect(root).toBeTruthy();
  expect(reply).toBeTruthy();
  await expect
    .poll(() =>
      relay.connections.some(({ subscriptions }) =>
        [...subscriptions.values()].some((filters) =>
          filters.some((filter) => filter["#e"]?.includes(root?.id ?? "")),
        ),
      ),
    )
    .toBe(true);
  relay.add(
    sign(colleague, { kind: 7, content: "🎉", tags: [["e", root?.id ?? ""]] }),
  );
  await expect(page.getByRole("button", { name: "🎉 1" })).toBeVisible();
  await page.getByLabel("Сообщение", { exact: true }).focus();
  await expect
    .poll(() => relay.sent.filter((event) => event.kind === 30078).length)
    .toBeGreaterThan(0);
  const contexts = Object.assign(
    {},
    ...relay.sent
      .filter((event) => event.kind === 30078)
      .map((event) => readContexts(event, employee)),
  );
  for (const event of relay.sent.filter((event) => event.kind === 30078)) {
    expect(event.tags.find((tag) => tag[0] === "d")?.[1]).toMatch(
      /^read-state:[a-f0-9]{32}$/,
    );
  }
  expect(contexts[`msg:${root?.id}`]).toBeDefined();
  expect(contexts[`msg:${reply?.id}`]).toBeUndefined();
  const slotKey = `airhop.chat.read-slot.${origin}.${employee.pubkey}`;
  const slot = await page.evaluate((key) => localStorage.getItem(key), slotKey);
  expect(slot).toMatch(/^[a-f0-9]{32}$/);
  relay.add(
    makeReadState(
      employee,
      slot as string,
      "another-installation",
      {},
      Math.floor(Date.now() / 1000) + 1,
    ),
  );
  await expect
    .poll(() => page.evaluate((key) => localStorage.getItem(key), slotKey))
    .not.toBe(slot);
});

test("file upload is signed and acknowledged before sending the attachment", async ({
  page,
}) => {
  const relay = new RelayFixture();
  await relay.install(page);
  let signedUpload = false;
  await page.route(`${origin}/upload`, (route) => {
    const headers = route.request().headers();
    const auth = JSON.parse(
      Buffer.from(headers.authorization.slice(6), "base64url").toString(),
    );
    signedUpload =
      verifyEvent(auth) &&
      auth.pubkey === employee.pubkey &&
      auth.tags.some(
        (tag: string[]) => tag[0] === "x" && tag[1] === headers["x-sha-256"],
      );
    return route.fulfill({
      json: {
        sha256: headers["x-sha-256"],
        url: `${origin}/media/${headers["x-sha-256"]}.txt`,
      },
    });
  });
  await unlock(page);
  await page.getByRole("button", { name: "# Команда" }).click();
  await page.getByLabel("Выбрать файл").setInputFiles({
    name: "Инструкция.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Инструкция для команды"),
  });
  await expect(page.locator(".chat-file-chip")).toContainText("Инструкция.txt");
  expect(signedUpload).toBe(true);
  await page.getByRole("button", { name: "Отправить", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Открыть файл: Инструкция.txt" }),
  ).toBeVisible();
  expect(
    relay.sent.some(
      (event) =>
        event.kind === 9 && event.tags.some((tag) => tag[0] === "imeta"),
    ),
  ).toBe(true);
});

test("installable shell works offline and caches no identity, messages or media", async ({
  page,
  context,
  browserName,
}) => {
  test.fixme(
    browserName === "webkit",
    "Offline reload aborts in Playwright WebKit. Service-worker tooling is Chromium-only (https://playwright.dev/docs/service-workers); real iPhone offline acceptance remains open.",
  );
  const relay = new RelayFixture();
  await relay.install(page);
  await unlock(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await caches.keys()).filter((key) =>
            key.startsWith("airhop-chat-shell-"),
          ).length,
      ),
    )
    .toBeGreaterThan(0);
  const urls = await page.evaluate(async () => {
    const keys = await caches.keys();
    return (
      await Promise.all(
        keys.map(async (key) =>
          (await (await caches.open(key)).keys()).map((request) => request.url),
        ),
      )
    ).flat();
  });
  expect(urls.some((url) => new URL(url).pathname === "/chat")).toBe(true);
  expect(
    urls.every(
      (url) =>
        new URL(url).pathname === "/chat" ||
        new URL(url).pathname.startsWith("/chat-assets/"),
    ),
  ).toBe(true);
  // Reload once to make this client controlled before disconnecting the network.
  await page.reload();
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await context.setOffline(true);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "С возвращением" }),
  ).toBeVisible();
  await context.setOffline(false);
});

test("visual QA: mobile conversations and desktop layout", async ({
  page,
}, testInfo) => {
  const relay = new RelayFixture();
  await relay.install(page);
  await unlock(page);
  await page.evaluate(() => document.fonts.ready);
  await waitForAnimations(page);
  await page.screenshot({ path: testInfo.outputPath("chat-list.png") });
  await page.getByRole("button", { name: "# Команда" }).click();
  await expect(page.getByRole("button", { name: "Ветка · 1" })).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: testInfo.outputPath("chat-mobile.png") });
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(page.getByRole("navigation")).toBeVisible();
  await waitForAnimations(page);
  await page.screenshot({ path: testInfo.outputPath("chat-desktop.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
});
