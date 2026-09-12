import { expect, test } from "@playwright/test";
import { waitForAnimations } from "../helpers/animations";

test("employee invite opens the installed AirHop app without native browser dependencies", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/api/join-policy", (route) =>
    route.fulfill({ json: { policy: null } }),
  );
  await page.goto("/invite/v2.staff-token");
  const open = page.getByTestId("staff-invite-open");
  await expect(open).toBeVisible();
  const link = new URL((await open.getAttribute("href")) ?? "");
  expect(link.protocol).toBe("airhop:");
  expect(link.hostname).toBe("join");
  expect(link.searchParams.get("relay")).toBe("ws://127.0.0.1:4186");
  expect(link.searchParams.get("code")).toBe("v2.staff-token");
  await expect(page.getByTestId("staff-invite-link")).toHaveValue(
    "http://127.0.0.1:4186/invite/v2.staff-token",
  );
  expect(errors).toEqual([]);
  await page.reload();
  await expect(open).toBeVisible();
});

test("policy acceptance is explicit and its receipt reaches the app", async ({
  page,
}) => {
  await page.route("**/api/join-policy", (route) =>
    route.fulfill({
      json: {
        policy: {
          terms_markdown: "Terms",
          privacy_markdown: "Privacy",
          age_attestation_required: true,
          version: "v1",
        },
      },
    }),
  );
  const receipts: unknown[] = [];
  await page.route("**/api/invites/accept-policy", (route) => {
    receipts.push(route.request().postDataJSON());
    return route.fulfill({ json: { receipt: "bound-receipt" } });
  });
  await page.goto("/invite/v2.staff-token");
  await expect(page.getByTestId("staff-invite-accept")).toBeDisabled();
  await page.getByTestId("staff-invite-age").check();
  await page.getByTestId("staff-invite-agreement").check();
  await page.getByTestId("staff-invite-accept").click();
  await expect(page.getByTestId("staff-invite-open")).toHaveAttribute(
    "href",
    /policy_receipt=bound-receipt/,
  );
  expect(receipts).toEqual([
    { code: "v2.staff-token", policy_version: "v1", age_confirmed: true },
  ]);
  await expect(page.getByTestId("staff-invite-link")).toHaveValue(
    "http://127.0.0.1:4186/invite/v2.staff-token?policy_receipt=bound-receipt",
  );
});

test("the invitation is usable in Russian on a narrow screen", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route("**/api/join-policy", (route) =>
    route.fulfill({ json: { policy: null } }),
  );
  await page.goto("/invite/v2.staff-token");
  await page.getByRole("button", { name: "Русский" }).click();
  await expect(
    page.getByRole("heading", { name: "Приглашение в Airhop Center" }),
  ).toBeVisible();
  await expect(page.getByTestId("staff-invite-open")).toHaveText(
    "Открыть Airhop Center",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await waitForAnimations(page);
  await page.screenshot({
    path: testInfo.outputPath("staff-invite-ru.png"),
    fullPage: true,
  });
});

test("a failed policy request can be retried and never enables joining early", async ({
  page,
}) => {
  let attempts = 0;
  await page.route("**/api/join-policy", (route) =>
    route.fulfill(
      ++attempts === 1
        ? { status: 503, json: { error: "unavailable" } }
        : { json: { policy: null } },
    ),
  );
  await page.goto("/invite/v2.staff-token");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByTestId("staff-invite-open")).toHaveCount(0);
  await page.getByTestId("staff-invite-retry").click();
  await expect(page.getByTestId("staff-invite-open")).toBeVisible();
});
