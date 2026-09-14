import { expect, test, type Page } from "@playwright/test";
import type { RelayEvent } from "../../src/shared/api/types";
import { installMockBridge, TEST_IDENTITIES } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

const CHANNEL = "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50";
const ROOT = "d1".repeat(32);
const REPLY = "d2".repeat(32);
const RELAY = "ws://127.0.0.1:3000";
const STORAGE_KEY = `buzz-thread-activity.v1:${RELAY}:${"deadbeef".repeat(8)}`;
const TEXT = "Сохранённое уведомление: запись на занятие отменена.";

async function seedSavedNotification(page: Page, offline = false) {
  await page.addInitScript(
    ({ key, channelId, root, reply, text, pubkey }) => {
      localStorage.setItem("airhop.locale.v1", "ru-RU");
      localStorage.setItem(
        key,
        JSON.stringify([
          {
            id: reply,
            kind: 9,
            pubkey,
            content: text,
            createdAt: Math.floor(Date.now() / 1000),
            channelId,
            channelName: "general",
            tags: [
              ["h", channelId],
              ["e", root, "", "root"],
              ["e", root, "", "reply"],
            ],
          },
        ]),
      );
    },
    {
      key: STORAGE_KEY,
      channelId: CHANNEL,
      root: ROOT,
      reply: REPLY,
      text: TEXT,
      pubkey: TEST_IDENTITIES.alice.pubkey,
    },
  );
  await installMockBridge(
    page,
    {
      deletedEventIds: [ROOT, REPLY],
      eventLookupErrors: offline
        ? {
            [ROOT]: "relay unreachable: connection closed",
            [REPLY]: "relay unreachable: connection closed",
          }
        : undefined,
    },
    { relayWsUrl: RELAY },
  );
  await page.goto("/");
  await expect(page.getByTestId(`home-inbox-item-${REPLY}`)).toBeVisible();
}

test("saved missing discussion is read-only, survives reload, and does not affect a valid selection", async ({
  page,
}, testInfo) => {
  await seedSavedNotification(page);
  await page.getByTestId(`home-inbox-item-${REPLY}`).click();
  const notice = page.getByTestId("home-inbox-context-unavailable");
  const detail = page.getByTestId("home-inbox-detail");
  await expect(notice).toContainText("Обсуждение больше недоступно");
  await expect(detail).toContainText(TEXT);
  await expect(page.getByTestId("home-inbox-context-error")).toHaveCount(0);
  await expect(page.getByTestId("home-inbox-context-retry")).toHaveCount(0);
  await expect(detail.locator('[contenteditable="true"]')).toHaveCount(0);
  await expect(
    detail.getByRole("button", { name: "Отправить сообщение", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toContain(TEXT);

  await waitForAnimations(page);
  await detail.screenshot({
    path: testInfo.outputPath("unavailable-discussion.png"),
  });

  await page.reload();
  await expect(notice).toContainText("Обсуждение больше недоступно");
  await expect(detail).toContainText(TEXT);

  // A valid server-backed event must not inherit the prior unavailable state.
  const validId = await page.evaluate(
    ({ pubkey, channelId }) => {
      const win = window as Window & {
        __BUZZ_E2E_EMIT_MOCK_MESSAGE__: (
          input: Record<string, unknown>,
        ) => RelayEvent;
        __BUZZ_E2E_PUSH_MOCK_FEED_ITEM__: (
          input: Record<string, unknown>,
        ) => void;
      };
      const event = win.__BUZZ_E2E_EMIT_MOCK_MESSAGE__({
        channelName: "general",
        content: "Доступное обсуждение",
        pubkey,
        id: "d3".repeat(32),
      });
      win.__BUZZ_E2E_PUSH_MOCK_FEED_ITEM__({
        ...event,
        channel_id: channelId,
        channel_name: "general",
        category: "mention",
      });
      return event.id;
    },
    { pubkey: TEST_IDENTITIES.alice.pubkey, channelId: CHANNEL },
  );
  await page.getByTestId(`home-inbox-item-${validId}`).click();
  await expect(detail).toContainText("Доступное обсуждение");
  await expect(notice).toHaveCount(0);
  await expect(page.getByTestId("home-inbox-context-error")).toHaveCount(0);
  await expect(detail.locator('[contenteditable="true"]')).toBeVisible();
});

test("connection failure stays retryable and preserves the saved notification", async ({
  page,
}) => {
  await seedSavedNotification(page, true);
  await page.getByTestId(`home-inbox-item-${REPLY}`).click();
  await expect(page.getByTestId("home-inbox-context-error")).toBeVisible();
  await expect(page.getByTestId("home-inbox-context-unavailable")).toHaveCount(
    0,
  );
  await expect(page.getByTestId("home-inbox-detail")).toContainText(TEXT);
  expect(
    await page.evaluate((key) => localStorage.getItem(key), STORAGE_KEY),
  ).toContain(TEXT);
  await page.evaluate(() => {
    const win = window as Window & {
      __BUZZ_E2E__: { mock: { eventLookupErrors?: Record<string, string> } };
    };
    win.__BUZZ_E2E__.mock.eventLookupErrors = {};
  });
  await page.getByTestId("home-inbox-context-retry").click();
  await expect(
    page.getByTestId("home-inbox-context-unavailable"),
  ).toContainText("Обсуждение больше недоступно");
  await expect(page.getByTestId("home-inbox-context-error")).toHaveCount(0);
});
