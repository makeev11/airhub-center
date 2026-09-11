import { mkdirSync } from "node:fs";

import { expect, test, type Page } from "@playwright/test";

import { createInitialDemoBookingWorkspace } from "../../src/features/booking/data/demoBookingRepository";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const channelId = "33333333-3333-4333-8333-333333333333";
const communityId = "44444444-4444-4444-8444-444444444444";
const firstPubkey = "11".repeat(32);
const secondPubkey = "22".repeat(32);

async function installBranchFixture(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem("airhop.locale.v1", "ru-RU");
    window.localStorage.setItem("buzz:text-scale", "1.2");
    (
      window as Window & { __AIRHOP_E2E_STAFF_SERVER__?: boolean }
    ).__AIRHOP_E2E_STAFF_SERVER__ = true;
  });
  await installMockBridge(page);
  const demo = createInitialDemoBookingWorkspace();
  const baseBranch = demo.branches[0];
  const state = {
    branch: {
      ...baseBranch,
      id: branchId,
      organizationId,
      name: "Курская",
      address: "Москва, ул. Земляной Вал, 27, вход со двора",
      defaultBuzzChannelId: channelId,
      version: 3,
    },
    responsiblePubkeys: [firstPubkey, secondPubkey],
    routingMode: "modern" as "modern" | "legacy" | "unavailable" | "forbidden",
    routingQueries: [] as string[],
    commands: [] as Array<{
      branchId: string;
      expectedVersion: number;
      responsiblePubkeys: string[];
    }>,
    branchUpdates: 0,
  };

  await page.route("**/api/airhop/staff/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (
      url.pathname.endsWith(`/branches/${branchId}`) &&
      route.request().method() === "PUT"
    ) {
      const input = route.request().postDataJSON();
      expect(input.expectedVersion).toBe(state.branch.version);
      state.branch = {
        ...state.branch,
        ...input,
        version: state.branch.version + 1,
      };
      state.branchUpdates++;
      await route.fulfill({
        json: { branchId, version: state.branch.version, replayed: false },
      });
      return;
    }
    if (url.pathname.endsWith("/branches")) {
      await route.fulfill({
        json: {
          organization: { ...demo.organization, id: organizationId },
          organizationVersion: 1,
          items: [state.branch],
          rooms: [],
          groups: [],
          recurrenceRules: [],
          lessonExceptions: [],
          tariffs: [],
          teachers: [],
        },
      });
      return;
    }
    if (url.pathname.endsWith("/client-conversations")) {
      state.routingQueries.push(url.search);
      if (
        state.routingMode === "unavailable" ||
        state.routingMode === "forbidden"
      ) {
        await route.fulfill({
          status: state.routingMode === "forbidden" ? 403 : 503,
          json: { error: "Staff unavailable" },
        });
        return;
      }
      if (state.routingMode === "legacy") {
        if (url.searchParams.has("configurationOnly")) {
          await route.fulfill({
            status: 400,
            json: { error: "Invalid Inbox filters" },
          });
          return;
        }
        expect(url.searchParams.get("conversationId")).toBe(
          "00000000-0000-0000-0000-000000000000",
        );
      }
      await route.fulfill({
        json: {
          communityId,
          viewerPubkey: "aa".repeat(32),
          canManageRouting: true,
          connections: [],
          items: [],
          nextCursor: null,
          branches: [
            {
              id: branchId,
              name: "Курская",
              channelId,
              version: state.branch.version,
              responsiblePubkeys: state.responsiblePubkeys,
            },
          ],
          staff: [
            { pubkey: firstPubkey, name: "Анна Петрова", channelId },
            { pubkey: secondPubkey, name: "Мария Волкова", channelId },
            { pubkey: "33".repeat(32), name: "Игорь Соколов", channelId },
          ],
        },
      });
      return;
    }
    if (url.pathname.endsWith("/tracking-links")) {
      const createdAt = "2026-09-11T12:00:00.000Z";
      const links = [
        {
          id: "55555555-5555-4555-8555-555555555555",
          source: "yandex_maps",
          slug: "maps-yandex-kurskaya",
        },
        {
          id: "66666666-6666-4666-8666-666666666666",
          source: "google_maps",
          slug: "maps-google-kurskaya",
        },
        {
          id: "77777777-7777-4777-8777-777777777777",
          source: "two_gis",
          slug: "maps-2gis-kurskaya",
        },
      ];
      await route.fulfill({
        json: {
          redirectPath: "/go/",
          items: links.map(({ id, source, slug }) => ({
            id,
            slug,
            name: `${source} — Курская`,
            source,
            goal: "booking",
            destinationPath: "/booking/",
            branchId,
            status: "active",
            version: 1,
            openCount: 0,
            bookingCount: 0,
            contactClickCount: 0,
            createdAt,
          })),
        },
      });
      return;
    }
    await route.fulfill({ status: 404, json: { error: "Not mocked" } });
  });
  await page.route("**/events", async (route) => {
    const event = route.request().postDataJSON();
    expect(event.kind).toBe(9051);
    expect(event.tags).toContainEqual(["airhop-community", communityId]);
    const input = JSON.parse(event.content);
    expect(input.branchId).toBe(branchId);
    expect(input.expectedVersion).toBe(state.branch.version);
    state.commands.push(input);
    state.responsiblePubkeys = input.responsiblePubkeys;
    state.branch.version++;
    await route.fulfill({ json: { accepted: true, message: "{}" } });
  });
  return state;
}

async function openBranch(page: Page) {
  await page
    .getByTestId(`airhop-branch-${branchId}`)
    .getByRole("button", { name: "Редактировать" })
    .click();
  return page.getByTestId("airhop-branch-form");
}

test("branch address, responsibles, and tracked map links stay visually aligned", async ({
  page,
}) => {
  await installBranchFixture(page);
  mkdirSync("test-results/branch-settings-preview", { recursive: true });
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/#/booking/branches");
  const branchCard = page.getByTestId(`airhop-branch-${branchId}`);
  await branchCard.getByRole("button", { name: "Редактировать" }).click();

  const nameBox = await page.getByTestId("airhop-branch-name").boundingBox();
  const channelBox = await page
    .getByTestId("airhop-branch-channel")
    .boundingBox();
  expect(nameBox).not.toBeNull();
  expect(channelBox).not.toBeNull();
  expect(
    Math.abs((nameBox?.y ?? 0) - (channelBox?.y ?? 0)),
  ).toBeLessThanOrEqual(2);

  const settings = page.getByTestId("airhop-branch-operational-settings");
  await expect(settings.getByTestId("airhop-branch-address")).toHaveValue(
    "Москва, ул. Земляной Вал, 27, вход со двора",
  );
  await expect(settings.getByText("Анна Петрова")).toBeVisible();
  await expect(
    settings.getByRole("button", { name: /Копировать/ }),
  ).toHaveCount(3);
  await expect(
    settings.getByText("Скопируйте ссылку", { exact: false }),
  ).toBeVisible();

  await waitForAnimations(page);
  await page.screenshot({
    path: "test-results/branch-settings-preview/01-full-dialog.png",
  });
  await settings.scrollIntoViewIfNeeded();
  const trackingSettings = page.getByTestId("airhop-branch-tracking-settings");
  await trackingSettings.scrollIntoViewIfNeeded();
  await waitForAnimations(page);
  await trackingSettings.screenshot({
    path: "test-results/branch-settings-preview/02-operational-settings.png",
  });
});

test("legacy relay loads and saves branch responsibles with the refreshed branch version", async ({
  page,
}) => {
  const state = await installBranchFixture(page);
  state.routingMode = "legacy";
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.goto("/#/booking/branches");
  const dialog = await openBranch(page);
  await expect(
    dialog.getByRole("checkbox", { name: "Анна Петрова" }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "Мария Волкова" }),
  ).toBeChecked();
  await dialog.getByRole("checkbox", { name: "Анна Петрова" }).uncheck();
  await dialog.getByRole("checkbox", { name: "Игорь Соколов" }).check();
  await dialog
    .getByTestId("airhop-branch-address")
    .fill("Москва, Земляной Вал, 27, второй вход");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.branchUpdates).toBe(1);
  expect(state.commands).toHaveLength(1);
  expect(state.commands[0].expectedVersion).toBe(4);
  expect(state.responsiblePubkeys).toEqual([secondPubkey, "33".repeat(32)]);
  await openBranch(page);
  await expect(
    dialog.getByRole("checkbox", { name: "Анна Петрова" }),
  ).not.toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "Мария Волкова" }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "Игорь Соколов" }),
  ).toBeChecked();
  await expect(dialog.getByTestId("airhop-branch-address")).toHaveValue(
    "Москва, Земляной Вал, 27, второй вход",
  );
  expect(state.routingQueries).toEqual([
    "?configurationOnly=true",
    "?conversationId=00000000-0000-0000-0000-000000000000",
    "?configurationOnly=true",
    "?conversationId=00000000-0000-0000-0000-000000000000",
    "?configurationOnly=true",
    "?conversationId=00000000-0000-0000-0000-000000000000",
  ]);
  await waitForAnimations(page);
  await page
    .getByTestId("airhop-branch-responsibles")
    .screenshot({ path: "test-results/branch-responsibles-saved.png" });
});

test("retrying unavailable staff preserves typed branch settings and restores saved selections", async ({
  page,
}) => {
  const state = await installBranchFixture(page);
  state.routingMode = "unavailable";
  await page.goto("/#/booking/branches");
  const dialog = await openBranch(page);
  await expect(
    dialog.getByText(/Список сотрудников сейчас недоступен/),
  ).toBeVisible();
  await dialog.getByTestId("airhop-branch-name").fill("Курская — новый зал");
  await dialog
    .getByTestId("airhop-branch-address")
    .fill("Москва, новый вход со двора");
  state.routingMode = "legacy";
  await dialog.getByRole("button", { name: "Повторить загрузку" }).click();
  await expect(
    dialog.getByRole("checkbox", { name: "Анна Петрова" }),
  ).toBeChecked();
  await expect(
    dialog.getByRole("checkbox", { name: "Мария Волкова" }),
  ).toBeChecked();
  await expect(
    dialog.getByText(/Список сотрудников сейчас недоступен/),
  ).not.toBeVisible();
  await expect(dialog.getByTestId("airhop-branch-name")).toHaveValue(
    "Курская — новый зал",
  );
  await expect(dialog.getByTestId("airhop-branch-address")).toHaveValue(
    "Москва, новый вход со двора",
  );
  expect(state.commands).toHaveLength(0);
  expect(state.branchUpdates).toBe(0);
  expect(state.routingQueries).toEqual([
    "?configurationOnly=true",
    "?configurationOnly=true",
    "?conversationId=00000000-0000-0000-0000-000000000000",
  ]);
});

test("saving an address while staff access fails does not clear existing responsibles", async ({
  page,
}) => {
  const state = await installBranchFixture(page);
  state.routingMode = "forbidden";
  await page.goto("/#/booking/branches");
  const dialog = await openBranch(page);
  await expect(
    dialog.getByRole("button", { name: "Повторить загрузку" }),
  ).toBeVisible();
  await dialog
    .getByTestId("airhop-branch-address")
    .fill("Москва, уточнённый адрес");
  await dialog.getByRole("button", { name: "Сохранить", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(state.branchUpdates).toBe(1);
  expect(state.branch.address).toBe("Москва, уточнённый адрес");
  expect(state.commands).toHaveLength(0);
  expect(state.responsiblePubkeys).toEqual([firstPubkey, secondPubkey]);
  expect(state.routingQueries).toEqual(["?configurationOnly=true"]);
});
