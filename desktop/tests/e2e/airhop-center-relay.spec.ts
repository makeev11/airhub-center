import { expect, test, type Page } from "@playwright/test";

import { installRelayBridge, openCreateChannelDialog } from "../helpers/bridge";
import { assertRelaySeeded } from "../helpers/seed";

test.beforeAll(async () => {
  test.setTimeout(process.env.CI ? 90_000 : 30_000);
  await assertRelaySeeded();
});

async function openGeneral(page: Page, user: "tyler" | "alice") {
  await installRelayBridge(page, user);
  await page.goto("/");
  await page.getByTestId("channel-general").click();
  await expect(page.getByTestId("chat-title")).toHaveText("general");
  await expect(page.getByTestId("message-input")).toBeEnabled();
}

test("Center sends a relay message and restores it after reload", async ({
  page,
}) => {
  const message = `AirHop persisted message ${crypto.randomUUID()}`;
  await openGeneral(page, "tyler");
  await page.getByTestId("message-input").fill(message);
  await page.getByTestId("send-message").click();
  await expect(page.getByTestId("message-timeline")).toContainText(message);
  await page.reload();
  await expect(page.getByTestId("message-timeline")).toContainText(message);
  await page.getByTestId("channel-random").click();
  await expect(page.getByTestId("chat-title")).toHaveText("random");
  await expect(page.getByTestId("message-timeline")).not.toContainText(message);
});

test("Center delivers messages between two employees in real time", async ({
  browser,
}) => {
  const sender = await browser.newContext();
  const recipient = await browser.newContext();
  try {
    const senderPage = await sender.newPage();
    const recipientPage = await recipient.newPage();
    await Promise.all([
      openGeneral(senderPage, "tyler"),
      openGeneral(recipientPage, "alice"),
    ]);
    const message = `AirHop live message ${crypto.randomUUID()}`;
    await senderPage.getByTestId("message-input").fill(message);
    await senderPage.getByTestId("send-message").click();
    await expect(recipientPage.getByTestId("message-timeline")).toContainText(
      message,
    );
    const reply = `AirHop live reply ${crypto.randomUUID()}`;
    await recipientPage.getByTestId("message-input").fill(reply);
    await recipientPage.getByTestId("send-message").click();
    await expect(senderPage.getByTestId("message-timeline")).toContainText(
      reply,
    );
  } finally {
    await sender.close();
    await recipient.close();
  }
});

test("Center creates a working channel that survives reload", async ({
  page,
}) => {
  await openGeneral(page, "tyler");
  const name = `airhop-e2e-${crypto.randomUUID()}`;
  await openCreateChannelDialog(page);
  await page.getByTestId("create-channel-name").fill(name);
  await page
    .getByTestId("create-channel-description")
    .fill("AirHop relay integration");
  await page.getByTestId("create-channel-submit").click();
  await expect(page.getByTestId("chat-title")).toHaveText(name);
  await page.reload();
  await expect(page.getByTestId("chat-title")).toHaveText(name);
  await expect(page.getByTestId(`channel-${name}`)).toBeVisible();
});
