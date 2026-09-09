import { expect, test, type Page } from "@playwright/test";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";
import type { ClientInbox } from "../../src/features/client-inbox/data/clientInboxService";

const community = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const channel = "11111111-1111-4111-8111-111111111111";
const branch = "22222222-2222-4222-8222-222222222222";
const connection = "33333333-3333-4333-8333-333333333333";
const conversation = "44444444-4444-4444-8444-444444444444";
const owner = TEST_IDENTITIES.tyler.pubkey;

test("feedback dialog is Russian and explains its actual destination", async ({
  page,
}) => {
  await fixture(page);
  await page.getByTestId("sidebar-profile-avatar-button").click();
  await page.getByTestId("profile-popover-send-feedback").click();
  const dialog = page.getByTestId("send-feedback-dialog");
  await expect(dialog).toContainText("Отправить отзыв");
  await expect(dialog).toContainText("администраторам сервера");
  await expect(dialog).not.toContainText("Buzz");
  await expect(page.getByTestId("feedback-category-bug")).toHaveText("Ошибка");
  await expect(page.getByTestId("feedback-submit")).toBeDisabled();
  await waitForAnimations(page);
  await dialog.screenshot({ path: "test-results/feedback-russian.png" });
});

test("channel renders a named client card instead of the transport start command", async ({
  page,
}) => {
  const state = await fixture(page);
  state.data.items[0].parentName = "Анна Иванова";
  state.data.items[0].title = "Анна Иванова · Семья Ивановых";
  state.data.items[0].connectorPubkey = TEST_IDENTITIES.alice.pubkey;
  await page.getByTestId("channel-general").click();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
            channelName: "general",
          }) ?? false,
      ),
    )
    .toBe(true);
  await page.evaluate(
    ({ pubkey, id }) => {
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        content: "/start",
        pubkey,
        id,
      });
    },
    { pubkey: TEST_IDENTITIES.alice.pubkey, id: "ab".repeat(32) },
  );
  const card = page.getByTestId("client-conversation-card");
  await expect(card).toContainText("Анна Иванова · Семья Ивановых");
  await expect(card).not.toContainText("/start");
  await waitForAnimations(page);
  await card.screenshot({ path: "test-results/client-conversation-card.png" });
});

async function fixture(page: Page) {
  await page.addInitScript(() =>
    localStorage.setItem("airhop.locale.v1", "ru-RU"),
  );
  await installMockBridge(page);
  const data: ClientInbox = {
    communityId: community,
    viewerPubkey: owner,
    canManageRouting: true,
    nextCursor: null,
    connections: [{ id: connection, name: "Общий Telegram" }],
    branches: [
      {
        id: branch,
        name: "Северный",
        channelId: channel,
        version: 1,
        responsiblePubkeys: [],
      },
    ],
    staff: [{ pubkey: owner, name: "Андрей", channelId: channel }],
    items: [
      {
        id: conversation,
        channelId: channel,
        rootEventId: "ab".repeat(32),
        threaded: true,
        title: "Макеевы · Андрей · Платон",
        branchId: null,
        branchName: null,
        assignee: owner,
        status: "waiting_staff",
        version: 2,
        familyId: null,
        representativeId: null,
        owner: "hermes",
        provider: "telegram",
        connectionId: connection,
        connectionName: "Общий Telegram",
        connectionStatus: "active",
        updatedAt: "2026-09-09T12:00:00Z",
        lastInboundAt: "2026-09-09T12:00:00Z",
        legacyChannelId: null,
      },
    ],
  };
  const commands: Record<string, unknown>[] = [];
  let conflict = false;
  await page.route(
    "**/api/airhop/staff/v1/client-conversations**",
    async (route) => {
      const url = new URL(route.request().url());
      if (url.pathname.endsWith("migration-preview")) {
        await route.fulfill({
          json: {
            conversationId: conversation,
            version: 2,
            threaded: false,
            oldChannelId: channel,
            targetChannelId: branch,
            routeVersion: 3,
            pendingDeliveries: 1,
            unpublishedReplies: 0,
            liveTurns: 0,
          },
        });
        return;
      }
      const query = url.searchParams;
      const items = data.items.filter(
        (item) =>
          (!query.has("unassignedBranch") || item.branchId === null) &&
          (!query.has("branchId") || item.branchId === query.get("branchId")) &&
          (!query.has("status") || item.status === query.get("status")) &&
          (!query.has("assignee") || item.assignee === query.get("assignee")) &&
          item.title
            .toLowerCase()
            .includes((query.get("search") ?? "").toLowerCase()),
      );
      await route.fulfill({ json: { ...data, items } });
    },
  );
  await page.route("**/events", async (route) => {
    const event = route.request().postDataJSON();
    if (event.kind !== 9051) {
      await route.fallback();
      return;
    }
    expect(event.tags).toContainEqual(["airhop-community", community]);
    const input = JSON.parse(event.content);
    commands.push(input);
    if (conflict) {
      await route.fulfill({
        status: 400,
        json: {
          error:
            "conflict: client conversation changed; refresh before retrying",
        },
      });
      return;
    }
    if (input.conversationId) {
      expect(input.expectedVersion).toBe(data.items[0].version);
      if (input.action.type === "assign_branch") {
        data.items[0].branchId = input.action.branchId;
        data.items[0].branchName = "Северный";
      }
      if (input.action.type === "set_status")
        data.items[0].status = input.action.status;
      data.items[0].version++;
    } else {
      data.branches[0].responsiblePubkeys = input.responsiblePubkeys;
      data.branches[0].version++;
    }
    await route.fulfill({ json: { accepted: true, message: "{}" } });
  });
  await page.goto("/#/booking/inbox");
  await expect(page.getByTestId("client-conversation")).toHaveCount(1);
  return {
    data,
    commands,
    setConflict: (value: boolean) => {
      conflict = value;
    },
  };
}

test("client Inbox assigns branch without moving root and supports unknown/search/status filters", async ({
  page,
}) => {
  const state = await fixture(page);
  const title = page.getByRole("link", {
    name: "Макеевы · Андрей · Платон",
    exact: true,
  });
  const href = await title.getAttribute("href");
  expect(href).toContain(channel);
  expect(href).toContain("ab".repeat(32));
  await page
    .getByRole("combobox", {
      name: "Филиал обращения: Макеевы · Андрей · Платон",
    })
    .selectOption(branch);
  await expect(
    page.getByRole("combobox", {
      name: "Филиал обращения: Макеевы · Андрей · Платон",
    }),
  ).toHaveValue(branch);
  await expect(title).toHaveAttribute("href", href ?? "");
  expect(state.commands).toHaveLength(1);
  const assignedRequest = page.waitForRequest(
    (request) =>
      request.url().includes("client-conversations?") &&
      new URL(request.url()).searchParams.get("assignee") === owner,
  );
  await page
    .getByRole("combobox", { name: "Фильтр по сотруднику" })
    .selectOption(owner);
  await assignedRequest;
  await expect(page.getByTestId("client-conversation")).toHaveCount(1);
  await page
    .getByRole("combobox", { name: "Филиал", exact: true })
    .selectOption("unknown");
  await expect(page.getByTestId("client-conversation")).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Подключение", exact: true })
    .selectOption(connection);
  await page
    .getByRole("combobox", { name: "Филиал", exact: true })
    .selectOption("");
  await expect(page.getByTestId("client-conversation")).toHaveCount(1);
  await page
    .getByRole("textbox", { name: "Поиск клиента" })
    .fill("несуществующий");
  await expect(page.getByTestId("client-conversation")).toHaveCount(0);
  await page.getByRole("textbox", { name: "Поиск клиента" }).fill("Платон");
  await expect(page.getByTestId("client-conversation")).toHaveCount(1);
  await page
    .getByRole("combobox", {
      name: "Статус обращения: Макеевы · Андрей · Платон",
    })
    .selectOption("resolved");
  await expect(
    page.getByRole("combobox", {
      name: "Статус обращения: Макеевы · Андрей · Платон",
    }),
  ).toHaveValue("resolved");
  await expect(
    page.locator('[data-testid^="channel-"]').filter({ hasText: "Макеевы" }),
  ).toHaveCount(0);
  await waitForAnimations(page);
  await page
    .getByTestId("airhop-client-inbox")
    .screenshot({ path: "test-results/client-inbox.png" });
});

test("Inbox distinguishes human ownership from queue status and explains legacy channels", async ({
  page,
}) => {
  const state = await fixture(page);
  await expect(page.getByTestId("client-handler-state")).toContainText(
    "Диалог у Гермеса",
  );
  state.data.items[0].owner = "human";
  state.data.items[0].threaded = false;
  state.data.items[0].rootEventId = null;
  await page.reload();
  await expect(page.getByTestId("client-handler-state")).toContainText(
    "Гермес не отвечает автоматически",
  );
  await expect(
    page.getByText(/Старый формат: отдельный канал клиента/),
  ).toBeVisible();
});

test("routing settings are explicit and stale mutations never appear successful", async ({
  page,
}) => {
  const state = await fixture(page);
  await page
    .getByText("Ответственные за обращения филиалов", { exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Филиал для настройки" })
    .selectOption(branch);
  await page.getByRole("checkbox", { name: "Андрей", exact: true }).check();
  await page.getByRole("button", { name: "Сохранить ответственных" }).click();
  await expect.poll(() => state.commands.length).toBe(1);
  expect(state.commands[0].responsiblePubkeys).toEqual([owner]);
  state.setConflict(true);
  await page
    .getByRole("combobox", {
      name: "Статус обращения: Макеевы · Андрей · Платон",
    })
    .selectOption("resolved");
  await expect(page.getByRole("alert")).toContainText("conflict:");
  await expect(
    page.getByRole("combobox", {
      name: "Статус обращения: Макеевы · Андрей · Платон",
    }),
  ).toHaveValue("waiting_staff");
});

test("legacy preview cannot migrate while a delivery is pending", async ({
  page,
}) => {
  const state = await fixture(page);
  state.data.items[0].threaded = false;
  state.data.items[0].rootEventId = null;
  await page.getByRole("button", { name: "Обновить", exact: true }).click();
  await page
    .getByRole("button", { name: "Проверить перенос старого разговора" })
    .click();
  await expect(
    page.getByRole("button", { name: "Перенести и сохранить архив" }),
  ).toBeDisabled();
  expect(state.commands).toHaveLength(0);
});
