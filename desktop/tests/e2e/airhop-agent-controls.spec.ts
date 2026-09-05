import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";

const team = [
  { role: "fizz", personaId: "builtin:airhop-fizz", name: "Физ" },
  {
    role: "administrator",
    personaId: "builtin:airhop-administrator",
    name: "Администратор",
  },
  { role: "analyst", personaId: "builtin:airhop-analyst", name: "Аналитик" },
  {
    role: "content_marketer",
    personaId: "builtin:airhop-content-marketer",
    name: "Контент-маркетолог",
  },
].map((agent, index) => ({
  ...agent,
  pubkey: (index + 1).toString(16).repeat(64),
  status: "stopped" as const,
}));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("airhop.locale.v1", "ru-RU");
  });
});

async function readEnabledState(page: Page, pubkey: string) {
  return page.evaluate(async (key) => {
    const agents = (await window.__BUZZ_E2E_INVOKE_MOCK_COMMAND__?.(
      "list_managed_agents",
      {},
    )) as Array<{
      pubkey: string;
      status: string;
      start_on_app_launch: boolean;
    }>;
    const agent = agents.find((entry) => entry.pubkey === key);
    return {
      status: agent?.status,
      startOnLaunch: agent?.start_on_app_launch,
    };
  }, pubkey);
}

test("team switches persist launch preference and control all four agents", async ({
  page,
}) => {
  await installMockBridge(page, { managedAgents: team });
  await page.goto("/#/agents");
  await expect(
    page.getByRole("heading", { name: "Команда Airhop" }),
  ).toBeVisible();

  for (const agent of team) {
    const card = page.getByTestId(`airhop-agent-card-${agent.role}`);
    await expect(card.getByRole("heading")).toHaveText(agent.name);
    await expect(card.getByRole("switch")).not.toBeChecked();
  }

  await page.getByRole("button", { name: "Включить всех" }).click();
  for (const agent of team) {
    await expect(
      page.getByTestId(`airhop-agent-card-${agent.role}`).getByRole("switch"),
    ).toBeChecked();
    await expect
      .poll(() => readEnabledState(page, agent.pubkey))
      .toEqual({
        status: "running",
        startOnLaunch: true,
      });
  }

  await page.getByRole("button", { name: "Выключить всех" }).click();
  for (const agent of team) {
    await expect(
      page.getByTestId(`airhop-agent-card-${agent.role}`).getByRole("switch"),
    ).not.toBeChecked();
    await expect
      .poll(() => readEnabledState(page, agent.pubkey))
      .toEqual({
        status: "stopped",
        startOnLaunch: false,
      });
  }
});

test("failed agent launch is reported and disarms automatic restart", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: team,
    startManagedAgentErrors: ["Test runtime unavailable"],
  });
  await page.goto("/#/agents");
  await page.getByTestId("airhop-agent-card-fizz").getByRole("switch").click();
  await expect(
    page.getByText("Не удалось изменить состояние агента."),
  ).toBeVisible();
  await expect
    .poll(() => readEnabledState(page, team[0].pubkey))
    .toEqual({
      status: "stopped",
      startOnLaunch: false,
    });
});

test("missing team members remain visibly unavailable", async ({ page }) => {
  await installMockBridge(page, { managedAgents: [] });
  await page.goto("/#/agents");
  for (const agent of team) {
    const card = page.getByTestId(`airhop-agent-card-${agent.role}`);
    await expect(card).toContainText("Ещё не подключён");
    await expect(card.getByRole("switch")).toBeDisabled();
  }
  await expect(
    page.getByRole("button", { name: "Включить всех" }),
  ).toBeDisabled();
});
