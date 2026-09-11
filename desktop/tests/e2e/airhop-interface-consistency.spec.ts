import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { installMockBridge } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";
import { waitForAnimations } from "../helpers/animations";

const owner = "deadbeef".repeat(8);
const org = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const service = "a".repeat(64),
  connector = "b".repeat(64),
  unnamed = "c".repeat(64);
const directory = {
  communityId: org,
  organizationId: org,
  agents: [
    {
      id: org + ":fizz",
      role: "fizz",
      pubkey: "1".repeat(64),
      deploymentId: null,
    },
    {
      id: org + ":analyst",
      role: "analyst",
      pubkey: "2".repeat(64),
      deploymentId: null,
    },
    {
      id: org + ":parent_administrator",
      role: "parent_administrator",
      pubkey: service,
      deploymentId: org,
    },
  ],
  principals: [
    { pubkey: service, kind: "agent" },
    { pubkey: connector, kind: "connector" },
  ],
};
async function fixture(page: Page, theme = "new-slack") {
  await page.addInitScript((theme) => {
    localStorage.setItem("airhop.locale.v1", "ru-RU");
    localStorage.setItem("buzz-theme", theme);
    localStorage.setItem("buzz-follow-system", "false");
  }, theme);
  await installMockBridge(page, {
    relayRequiresMembership: true,
    relayRole: "owner",
    principalDirectory: directory,
    emptyChannelHistory: true,
    relayMembers: [service, connector, unnamed].map((pubkey) => ({
      pubkey,
      role: "member" as const,
    })),
    personas: [
      { id: "builtin:honey", displayName: "Honey", systemPrompt: "global" },
      { id: "builtin:bumble", displayName: "Bumble", systemPrompt: "global" },
      {
        id: "legacy:fizz",
        displayName: "Fizz",
        systemPrompt: "legacy duplicate",
      },
      {
        id: "other:analyst",
        displayName: "Foreign analyst",
        systemPrompt: "other community",
      },
    ],
  });
  await page.goto("/");
  await page.getByTestId("channel-general").waitFor();
  await page.evaluate(async () => {
    window.__BUZZ_E2E_MUTATE_CHANNEL__?.({
      channelId: "9a1657ac-f7aa-5db0-b632-d8bbeb6dfb50",
      topic: null,
      purpose: null,
      description: "General conversation and community updates.",
    });
    await window.__BUZZ_E2E_INVALIDATE_CHANNELS__?.();
  });
}
async function changeLocale(page: Page, locale: string) {
  await page.evaluate((locale) => {
    localStorage.setItem("airhop.locale.v1", locale);
    window.dispatchEvent(
      new CustomEvent("airhop:locale-change", { detail: locale }),
    );
  }, locale);
}

test("Welcome keeps a compact introduction and clips sidebar scrolling below search", async ({
  page,
}) => {
  await fixture(page);
  await page.evaluate(async () => {
    const bridge = window as unknown as {
      __TAURI_INTERNALS__: {
        invoke: (command: string, args: unknown) => Promise<{ id: string }>;
      };
    };
    const channel = await bridge.__TAURI_INTERNALS__.invoke("create_channel", {
      name: "Welcome",
      channelType: "stream",
      visibility: "private",
      description: "A private channel for getting oriented in this community.",
    });
    await window.__BUZZ_E2E_INVALIDATE_CHANNELS__?.();
    window.location.hash = `/channels/${channel.id}`;
  });
  const intro = page.getByTestId("message-channel-intro");
  await expect(intro).toContainText("Здесь вы познакомитесь с командой центра");
  await expect(intro.getByRole("button")).toHaveCount(0);
  const personaMention = page.getByTestId("welcome-composer-persona-mention");
  await expect(personaMention).toHaveAttribute("data-active-persona", "Fizz");
  await expect(personaMention.locator(".sr-only")).toHaveText("Физ");
  await expect(page.getByTestId("welcome-composer-guide-banner")).toContainText(
    "Упоминание не нужно",
  );
  const content = page.getByTestId("sidebar-channel-content");
  await expect(content).toHaveCSS("overflow-y", "hidden");
  const header = await page.getByTestId("sidebar-pinned-header").boundingBox();
  const body = await content.boundingBox();
  expect(body?.y).toBeGreaterThanOrEqual(
    (header?.y ?? 0) + (header?.height ?? 0),
  );
  await shot(page, page.getByTestId("app-sidebar"), "welcome-sidebar");
  await shot(page, intro, "welcome-introduction");
});
async function shot(page: Page, locator: Locator, name: string) {
  await waitForAnimations(page);
  return createHash("sha256")
    .update(
      await locator.screenshot({
        path: `test-results/airhop-interface/${name}.png`,
      }),
    )
    .digest("hex");
}
async function contrast(locator: Locator, chrome = false) {
  return locator.evaluate((node, chrome) => {
    const context = document.createElement("canvas").getContext("2d");
    if (!context) throw new Error("Canvas unavailable");
    const rgba = (value: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = value;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].map((v, i) =>
        i === 3 ? v / 255 : v,
      );
    };
    const over = (fg: number[], bg: number[]) =>
      fg
        .slice(0, 3)
        .map((v, i) => v * fg[3] + bg[i] * (1 - fg[3]))
        .concat(1);
    const luminance = (rgb: number[]) =>
      rgb
        .slice(0, 3)
        .map((v) => {
          v /= 255;
          return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
        })
        .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
    const style = getComputedStyle(node),
      root = getComputedStyle(document.documentElement);
    let backgrounds: number[][] = [];
    if (chrome && document.documentElement.hasAttribute("data-buzz-sidebar")) {
      backgrounds = ["--buzz-gradient-top", "--buzz-gradient-bottom"].map(
        (key) => rgba(root.getPropertyValue(key)),
      );
    } else {
      let ancestor: Element | null = node.parentElement,
        background = rgba("white");
      while (ancestor) {
        const color = rgba(getComputedStyle(ancestor).backgroundColor);
        if (color[3] === 1) {
          background = color;
          break;
        }
        ancestor = ancestor.parentElement;
      }
      backgrounds = [background];
    }
    const foreground = rgba(style.color);
    foreground[3] *= Number(style.opacity);
    return Math.min(
      ...backgrounds.map((background) => {
        const bg = over(rgba(style.backgroundColor), background),
          fg = over(foreground, bg);
        const a = luminance(fg),
          b = luminance(bg);
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }),
    );
  }, chrome);
}
for (const theme of [
  "buzz",
  "buzz-dark",
  "new-slack",
  "new-slack-dark",
  "openai-light",
  "openai-dark",
]) {
  test(`readable chrome and destructive controls: ${theme}`, async ({
    page,
  }) => {
    await fixture(page, theme);
    const back = page.getByTestId("global-back"),
      forward = page.getByTestId("global-forward");
    await expect(forward).toBeDisabled();
    expect(await contrast(forward, true)).toBeGreaterThanOrEqual(3);
    await page.getByTestId("channel-general").click();
    await expect(back).toBeEnabled();
    const normal = await back.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    await back.hover();
    expect(await contrast(back, true)).toBeGreaterThanOrEqual(3);
    const hover = await back.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(hover).not.toBe(normal);
    const hoverHash = await shot(
      page,
      page.getByTestId("app-top-chrome"),
      theme + "-hover",
    );
    await page.mouse.down();
    expect(await contrast(back, true)).toBeGreaterThanOrEqual(3);
    const active = await back.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(active).not.toBe(hover);
    await shot(page, page.getByTestId("app-top-chrome"), `${theme}-active`);
    await page.mouse.move(700, 400);
    await page.mouse.up();
    await page.keyboard.press("Tab");
    await back.focus();
    expect(
      await back.evaluate((el) => getComputedStyle(el).boxShadow),
    ).not.toBe("none");
    expect(await contrast(back, true)).toBeGreaterThanOrEqual(3);
    const focusHash = await shot(
      page,
      page.getByTestId("app-top-chrome"),
      theme + "-focus",
    );
    expect(focusHash).not.toBe(hoverHash);
    await openSettings(page, "community-members");
    await page.getByTestId("relay-member-actions-" + owner).click();
    const remove = page.getByRole("menuitem", {
      name: "Удалить из центра",
      exact: true,
    });
    await expect(remove).toHaveAttribute("data-disabled");
    await expect(
      page.getByText("Нельзя удалить себя из центра."),
    ).toBeVisible();
    expect(await contrast(remove)).toBeGreaterThanOrEqual(4.5);
    await shot(page, page.getByRole("menu"), theme + "-disabled-menu");
    await page.keyboard.press("Escape");
    await page.getByTestId("relay-member-actions-" + unnamed).click();
    await expect(remove).not.toHaveAttribute("data-disabled");
    await remove.hover();
    expect(await contrast(remove)).toBeGreaterThanOrEqual(4.5);
    await shot(page, page.getByRole("menu"), theme + "-destructive-menu");
  });
}
test("Russian empty channel, system dates, locale change and canonical agent picker", async ({
  page,
}) => {
  await fixture(page);
  await page.getByTestId("channel-general").click();
  await expect(
    page.getByText("Это начало канала.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Общие разговоры и новости центра.", { exact: true }),
  ).toBeVisible();
  await shot(page, page.getByTestId("channel-drop-zone"), "ru-empty-channel");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.__BUZZ_E2E_HAS_MOCK_LIVE_SUBSCRIPTION__?.({
          channelName: "general",
          kind: 40099,
        }),
      ),
    )
    .toBe(true);
  await page.evaluate(
    (owner) =>
      window.__BUZZ_E2E_EMIT_MOCK_MESSAGE__?.({
        channelName: "general",
        kind: 40099,
        pubkey: owner,
        content: JSON.stringify({ type: "channel_created", actor: owner }),
        createdAt: new Date(2026, 8, 7, 12).getTime() / 1000,
      }),
    owner,
  );
  await expect(page.getByTestId("system-message-row")).toContainText(
    "Канал создан",
  );
  await expect(page.getByTestId("system-message-row")).toContainText("Вы");
  await expect(page.getByText(/понедельник, 7 сентября/).first()).toBeVisible();
  const composer = page
    .getByTestId("message-composer")
    .locator('[contenteditable="true"]');
  await composer.fill("Черновик остаётся");
  await changeLocale(page, "en-US");
  await expect(
    page.getByText("This is the beginning of the channel.", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("system-message-row")).toContainText(
    "created this channel",
  );
  await expect(composer).toContainText("Черновик остаётся");
  await changeLocale(page, "ru-RU");
  await page.getByTestId("channel-intro-action-create-agent").click();
  const dialog = page.getByTestId("add-channel-bot-dialog");
  await expect(dialog.getByTestId("organization-agent-option")).toHaveCount(3);
  await expect(dialog).toContainText("Ваши агенты · 3 агента");
  await expect(dialog).toContainText("Гермес");
  await expect(dialog).not.toContainText(
    /Honey|Bumble|Foreign analyst|Cancel|Your agents|Add agent/,
  );
  await shot(page, dialog, "ru-canonical-agents");
  await dialog.getByRole("checkbox").first().check();
  await dialog
    .getByRole("button", { name: "Добавить агента", exact: true })
    .click();
  await expect(dialog).not.toBeVisible();
});
test("employee count contains humans including an unnamed person, not service accounts", async ({
  page,
}) => {
  await fixture(page);
  await openSettings(page, "community-members");
  const screen = page.getByTestId("settings-community-members");
  await expect(
    screen.locator('[data-testid^="relay-member-row-"]'),
  ).toHaveCount(4);
  await expect(page.getByTestId("relay-member-row-" + service)).toHaveCount(0);
  await expect(page.getByTestId("relay-member-row-" + connector)).toHaveCount(
    0,
  );
  await expect(page.getByTestId("relay-member-row-" + unnamed)).toContainText(
    "Профиль не заполнен",
  );
  await shot(page, screen, "human-employees");
});

test("switching centers never reuses the previous center's registered agents", async ({
  page,
}) => {
  const second = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  await page.addInitScript(
    ({ owner }) => {
      localStorage.setItem("airhop.locale.v1", "ru-RU");
      localStorage.setItem(
        "buzz-communities",
        JSON.stringify([
          {
            id: "interface-a",
            name: "Первый центр",
            relayUrl: "ws://localhost:3000",
            pubkey: owner,
            addedAt: "2026-01-01",
          },
          {
            id: "interface-b",
            name: "Второй центр",
            relayUrl: "ws://localhost:3001",
            pubkey: owner,
            addedAt: "2026-01-02",
          },
        ]),
      );
      localStorage.setItem("buzz-active-community-id", "interface-a");
      localStorage.setItem(
        "buzz:welcome-channel-ensured.v1:ws%3A%2F%2Flocalhost%3A3001:" + owner,
        "true",
      );
    },
    { owner },
  );
  await installMockBridge(
    page,
    { principalDirectory: directory },
    { skipCommunitySeed: true },
  );
  await page.route(
    "http://localhost:3001/api/airhop/staff/v1/settings",
    (route) =>
      route.fulfill({
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Headers": "Authorization",
        },
        json: {
          principalDirectory: {
            communityId: second,
            organizationId: second,
            agents: [
              {
                id: second + ":administrator",
                role: "administrator",
                pubkey: "f".repeat(64),
                deploymentId: null,
              },
            ],
            principals: [],
          },
        },
      }),
  );
  await page.goto("/#/agents");
  await expect(page.getByTestId("airhop-agent-card-fizz")).toBeVisible();
  await expect(page.getByTestId("airhop-agent-card-analyst")).toBeVisible();
  await page.getByTestId("community-rail-button-interface-b").click();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("buzz-active-community-id")),
    )
    .toBe("interface-b");
  await page.getByRole("button", { name: "AI-агенты", exact: true }).click();
  await expect(
    page.getByTestId("airhop-agent-card-administrator"),
  ).toBeVisible();
  await expect(page.getByTestId("airhop-agent-card-fizz")).toHaveCount(0);
  await expect(page.getByTestId("airhop-agent-card-analyst")).toHaveCount(0);
});
