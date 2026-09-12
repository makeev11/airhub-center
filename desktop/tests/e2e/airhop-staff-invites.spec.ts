import { expect, test, type Page } from "@playwright/test";
import { installMockBridge } from "../helpers/bridge";
import { openSettings } from "../helpers/settings";

const first = "1".repeat(64);
const second = "2".repeat(64);
const principalDirectory = {
  communityId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  agents: [],
  principals: [],
};

test("employee claims a pasted invitation and enters the center without provisioning an owner team", async ({
  page,
}) => {
  const claims: unknown[] = [];
  await page.route("**/api/invites/claim", (route) => {
    claims.push(route.request().postDataJSON());
    return route.fulfill({
      json: {
        status: "joined",
        community_id: "staff-center",
        host: "staff.example.com",
        role: "member",
      },
    });
  });
  await page.addInitScript(() => {
    localStorage.setItem(
      `buzz-machine-onboarding-complete.v2:${"deadbeef".repeat(8)}`,
      "true",
    );
  });
  await installMockBridge(
    page,
    { relayRequiresMembership: true, relayRole: "member" },
    { skipCommunitySeed: true, skipOnboardingSeed: true },
  );
  await page.goto("/");
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page
    .getByLabel("Organization code")
    .fill(
      "https://staff.example.com/invite/v2.staff-token?policy_receipt=bound-receipt",
    );
  await page.getByTestId("airhop-owner-connect").click();
  await expect(page.getByTestId("sidebar-profile-avatar-button")).toBeVisible();
  expect(claims).toEqual([
    { code: "v2.staff-token", policy_receipt: "bound-receipt" },
  ]);
  expect(
    await page.evaluate(() =>
      window.__BUZZ_E2E_COMMANDS__?.filter(
        (command) => command === "ensure_starter_channels",
      ),
    ),
  ).toEqual([]);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("buzz-community-onboarding-transaction.v1"),
    ),
  ).toBeNull();
});

async function selectEmployee(page: Page, pubkey: string) {
  await page.getByTestId("member-pubkey-input").fill(pubkey);
  await page.getByTestId(`member-search-result-${pubkey}`).click();
}

test("owner can add an employee and a duplicate is identified", async ({
  page,
}) => {
  await installMockBridge(page, {
    relayRequiresMembership: true,
    principalDirectory,
  });
  await page.goto("/");
  await openSettings(page, "community-members");
  await page.getByTestId("community-invite-dialog-trigger").click();
  await selectEmployee(page, first);
  await page.getByTestId("confirm-add-member").click();
  await expect(page.getByTestId(`relay-member-row-${first}`)).toHaveCount(1);
  await page.getByTestId("member-pubkey-input").fill(first);
  await expect(
    page.getByText("This person is already a community member."),
  ).toBeVisible();
  await expect(page.getByTestId(`member-search-result-${first}`)).toHaveCount(
    0,
  );
});

test("a partial batch failure preserves only failed employees for retry", async ({
  page,
}) => {
  await installMockBridge(page, {
    relayRequiresMembership: true,
    principalDirectory,
  });
  await page.goto("/");
  await openSettings(page, "community-members");
  await page.evaluate((failedPubkey) => {
    const original = window.__TAURI_INTERNALS__.invoke;
    let failed = false;
    window.__TAURI_INTERNALS__.invoke = async (command, args) => {
      const input = args as { kind?: number; tags?: string[][] } | undefined;
      if (
        command === "sign_event" &&
        input?.kind === 9030 &&
        input.tags?.some((tag) => tag[0] === "p" && tag[1] === failedPubkey) &&
        !failed
      ) {
        failed = true;
        throw new Error("Test connection interrupted");
      }
      return original(command, args);
    };
  }, second);
  await page.getByTestId("community-invite-dialog-trigger").click();
  await selectEmployee(page, first);
  await selectEmployee(page, second);
  await page.getByTestId("confirm-add-member").click();
  await expect(
    page.getByText("Test connection interrupted", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByTestId(`member-search-selection-remove-${first}`),
  ).toHaveCount(0);
  await expect(
    page.getByTestId(`member-search-selection-remove-${second}`),
  ).toBeVisible();
  await expect(page.getByTestId(`relay-member-row-${second}`)).toHaveCount(0);
  await page.getByTestId("confirm-add-member").click();
  await expect(page.getByTestId(`relay-member-row-${second}`)).toHaveCount(1);
  const targets = await page.evaluate(() =>
    window.__BUZZ_E2E_SIGNED_EVENTS__
      ?.filter((event) => event.kind === 9030)
      .map((event) => event.tags.find((tag) => tag[0] === "p")?.[1]),
  );
  expect(targets).toEqual([first, second]);
});

test("a joining employee appears while the administrator keeps the roster open", async ({
  page,
}) => {
  await installMockBridge(page, {
    relayRequiresMembership: true,
    principalDirectory,
  });
  await page.goto("/");
  await openSettings(page, "community-members");
  // Simulate another client's successful claim by adding its membership on the
  // relay transport, without invoking this screen's mutation/cache invalidation.
  await page.evaluate(async (pubkey) => {
    const signed = await window.__TAURI_INTERNALS__.invoke("sign_event", {
      kind: 9030,
      content: "",
      tags: [
        ["p", pubkey],
        ["role", "member"],
      ],
    });
    const send = window.__BUZZ_E2E_COMMAND_LOG__?.findLast(
      (entry) => entry.command === "plugin:websocket|send",
    );
    if (!send?.payload) throw new Error("No connected relay socket");
    await window.__TAURI_INTERNALS__.invoke("plugin:websocket|send", {
      ...send.payload,
      message: {
        type: "Text",
        data: JSON.stringify(["EVENT", JSON.parse(signed as string)]),
      },
    });
  }, first);
  await expect(page.getByTestId(`relay-member-row-${first}`)).toHaveCount(1, {
    timeout: 20_000,
  });
});
