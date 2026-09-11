import { mkdirSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { createInitialDemoBookingWorkspace } from "../../src/features/booking/data/demoBookingRepository";
import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const organizationId = "11111111-1111-4111-8111-111111111111";
const branchId = "22222222-2222-4222-8222-222222222222";
const channelId = "33333333-3333-4333-8333-333333333333";
const communityId = "44444444-4444-4444-8444-444444444444";
const firstPubkey = "11".repeat(32);
const secondPubkey = "22".repeat(32);

test.beforeEach(async ({ page }) => {
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

  await page.route("**/api/airhop/staff/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/branches")) {
      await route.fulfill({
        json: {
          organization: { ...demo.organization, id: organizationId },
          organizationVersion: 1,
          items: [
            {
              ...baseBranch,
              id: branchId,
              organizationId,
              name: "Курская",
              address: "Москва, ул. Земляной Вал, 27, вход со двора",
              defaultBuzzChannelId: channelId,
              version: 3,
            },
          ],
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
              version: 3,
              responsiblePubkeys: [firstPubkey, secondPubkey],
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
});

test("branch address, responsibles, and tracked map links stay visually aligned", async ({
  page,
}) => {
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
