import { expect, test, type Page } from "@playwright/test";

import { installMockBridge } from "../helpers/bridge";
import { waitForAnimations } from "../helpers/animations";

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
  respondTo: "anyone" as const,
}));

const registeredDirectory = {
  communityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  agents: team.map((agent) => ({
    id: agent.role,
    role: agent.role,
    pubkey: agent.pubkey,
    deploymentId: null,
  })),
  principals: team.map((agent) => ({ pubkey: agent.pubkey, kind: "agent" })),
};
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
  await installMockBridge(page, {
    managedAgents: team,
    principalDirectory: registeredDirectory,
  });
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
    principalDirectory: registeredDirectory,
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
  await installMockBridge(page, {
    managedAgents: [],
    principalDirectory: registeredDirectory,
  });
  await page.goto("/#/agents");
  for (const agent of team) {
    const card = page.getByTestId(`airhop-agent-card-${agent.role}`);
    await expect(card).toContainText("Подключён к центру");
    await expect(card.getByRole("switch")).toBeDisabled();
  }
  await expect(
    page.getByRole("button", { name: "Включить всех" }),
  ).toBeDisabled();
});

function dutyPolicies(canManage = true) {
  return {
    schemaVersion: "airhop.agent-policies.v1" as const,
    canManage,
    policies: [...team.map((agent) => agent.role), "parent_administrator"].map(
      (role) => ({
        role: role as import("../../src/features/airhop-agents/model/agentPolicy").AgentPolicyEntry["role"],
        version: 0,
        policy: {
          enabled: true,
          learning: "observe" as const,
          birthdays:
            role === "administrator"
              ? {
                  enabled: true,
                  today: true,
                  advanceDays: 2,
                  time: { hour: 9, minute: 0 },
                  destination: { mode: "branches" as const },
                }
              : null,
          analytics:
            role === "analyst"
              ? {
                  enabled: true,
                  channelId: null,
                  time: { hour: 9, minute: 0 },
                  weekday: null,
                  sections: [
                    "bookings",
                    "payments",
                    "attendance",
                    "capacity",
                    "acquisition",
                  ] as (
                    | "bookings"
                    | "payments"
                    | "attendance"
                    | "capacity"
                    | "acquisition"
                  )[],
                }
              : null,
          content:
            role === "content_marketer" ? { websiteEditing: true } : null,
        },
      }),
    ),
  };
}

async function openDuties(page: Page, role: string) {
  const settings = page.getByTestId(`agent-duty-settings-${role}`);
  await settings.locator("summary").click();
  return settings;
}

test("role duties save birthday lead time, report selection and website permission", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: team,
    principalDirectory: registeredDirectory,
    agentPolicies: dutyPolicies(),
  });
  await page.goto("/#/agents");
  const admin = await openDuties(page, "administrator");
  await expect(
    admin.getByLabel("За сколько дней предупредить заранее"),
  ).toHaveValue("2");
  await expect(admin.getByLabel("Куда отправлять")).toHaveValue("default");
  await expect(
    admin.getByLabel("Время отправки", { exact: false }),
  ).toHaveValue("09:00");
  await expect(
    page
      .getByTestId("airhop-agent-card-administrator")
      .getByText("Все сотрудники", { exact: true }),
  ).toBeVisible();
  await waitForAnimations(page);
  await page
    .getByTestId("airhop-agent-card-administrator")
    .screenshot({ path: "test-results/agent-platform-administrator.png" });
  await admin.getByLabel("За сколько дней предупредить заранее").fill("3");
  await admin.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(admin.getByRole("status")).toHaveText("Сохранено");
  const analyst = await openDuties(page, "analyst");
  await analyst.getByRole("switch", { name: "Оплаты и задолженность" }).click();
  await analyst.getByLabel("Как часто").selectOption("1");
  await analyst.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(analyst.getByRole("status")).toHaveText("Сохранено");
  const content = await openDuties(page, "content_marketer");
  await content
    .getByRole("switch", { name: "Разрешить изменения контента сайта" })
    .click();
  await content.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(content.getByRole("status")).toHaveText("Сохранено");
  await page.evaluate(() => {
    window.location.hash = "/channels/general";
  });
  await expect(
    page.getByTestId("agent-duty-settings-administrator"),
  ).toHaveCount(0);
  await page.evaluate(() => {
    window.location.hash = "/agents";
  });
  await openDuties(page, "administrator");
  await expect(
    page.getByLabel("За сколько дней предупредить заранее"),
  ).toHaveValue("3");
  await openDuties(page, "analyst");
  await expect(
    page.getByRole("switch", { name: "Оплаты и задолженность" }),
  ).not.toBeChecked();
  await openDuties(page, "content_marketer");
  await expect(
    page.getByRole("switch", { name: "Разрешить изменения контента сайта" }),
  ).not.toBeChecked();
});

test("team members see duties while server-owned management remains read only", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: team,
    principalDirectory: registeredDirectory,
    agentPolicies: dutyPolicies(false),
  });
  await page.goto("/#/agents");
  for (const agent of team) {
    const settings = await openDuties(page, agent.role);
    await expect(
      page
        .getByTestId(`airhop-agent-card-${agent.role}`)
        .getByRole("switch", { name: new RegExp(`^${agent.name}:`) }),
    ).toBeDisabled();
    await expect(
      settings.getByText("Сотрудники могут обращаться к агенту.", {
        exact: false,
      }),
    ).toBeVisible();
    await expect(
      settings.getByRole("button", { name: "Сохранить", exact: true }),
    ).toHaveCount(0);
  }
});

test("a rejected revision preserves the draft and offers current settings", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: team,
    principalDirectory: registeredDirectory,
    agentPolicies: dutyPolicies(),
    agentPolicyErrors: ["version conflict"],
  });
  await page.goto("/#/agents");
  const settings = await openDuties(page, "administrator");
  await settings.getByLabel("За сколько дней предупредить заранее").fill("4");
  await settings
    .getByRole("button", { name: "Сохранить", exact: true })
    .click();
  await expect(settings.getByRole("alert")).toBeVisible();
  await expect(
    settings.getByLabel("За сколько дней предупредить заранее"),
  ).toHaveValue("4");
  await settings
    .getByRole("button", { name: "Загрузить актуальные настройки" })
    .click();
  await expect(
    settings.getByLabel("За сколько дней предупредить заранее"),
  ).toHaveValue("2");
});

test("the main team switch also disables server duties and requires administrator permission", async ({
  page,
}) => {
  await installMockBridge(page, {
    managedAgents: team,
    principalDirectory: registeredDirectory,
    agentPolicies: dutyPolicies(),
  });
  await page.goto("/#/agents");
  await page.getByRole("button", { name: "Выключить всех" }).click();
  for (const agent of team) {
    await expect(
      page
        .getByTestId(`airhop-agent-card-${agent.role}`)
        .getByRole("switch", { name: new RegExp(`^${agent.name}:`) }),
    ).not.toBeChecked();
  }
  await page.getByRole("button", { name: "Включить всех" }).click();
  for (const agent of team) {
    await expect(
      page
        .getByTestId(`airhop-agent-card-${agent.role}`)
        .getByRole("switch", { name: new RegExp(`^${agent.name}:`) }),
    ).toBeChecked();
    await expect
      .poll(() => readEnabledState(page, agent.pubkey))
      .toEqual({ status: "running", startOnLaunch: true });
  }
});
