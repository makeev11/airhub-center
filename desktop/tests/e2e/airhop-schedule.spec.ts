import { expect, test, type Page } from "@playwright/test";

import { waitForAnimations } from "../helpers/animations";
import { installMockBridge } from "../helpers/bridge";

const BOOKING_STORAGE_KEY =
  "buzz-airhop.booking.workspace.v6:e2e-default-community";

type StableLessonRef = {
  recurrenceRuleId: string;
  originalDate: string;
};

async function persistConfirmedBookings(
  page: Page,
  lessonRef: StableLessonRef,
  count: number,
): Promise<void> {
  await page.evaluate(
    ({ storageKey, lessonRef, count }) => {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) throw new Error("Booking workspace was not persisted");
      const workspace = JSON.parse(raw);
      const usedIds = new Set<string>(
        workspace.bookings.map((booking: { id: string }) => booking.id),
      );
      const usedDigests = new Set<string>(
        workspace.bookings.flatMap(
          (booking: {
            managementTokenDigest: string;
            idempotencyKeyDigest: string;
          }) => [booking.managementTokenDigest, booking.idempotencyKeyDigest],
        ),
      );
      let sequence = workspace.bookings.length + 1;
      const nextDigest = () => {
        let digest = sequence.toString(16).padStart(64, "0");
        while (usedDigests.has(digest)) {
          sequence += 1;
          digest = sequence.toString(16).padStart(64, "0");
        }
        usedDigests.add(digest);
        sequence += 1;
        return digest;
      };

      for (let index = 0; index < count; index += 1) {
        let id = `e2e-confirmed-booking-${sequence}`;
        while (usedIds.has(id)) {
          sequence += 1;
          id = `e2e-confirmed-booking-${sequence}`;
        }
        usedIds.add(id);
        const familyId = `e2e-family-${sequence}`;
        const representativeId = `e2e-representative-${sequence}`;
        const childId = `e2e-child-${sequence}`;
        workspace.families.push({
          id: familyId,
          organizationId: workspace.organization.id,
          displayName: `Семья Лев ${index + 1}`,
          primaryRepresentativeId: representativeId,
          status: "active",
          createdAt: "2026-08-02T09:00:00.000Z",
          updatedAt: "2026-08-02T09:00:00.000Z",
        });
        workspace.representatives.push({
          id: representativeId,
          organizationId: workspace.organization.id,
          familyId,
          displayName: "Мария",
          phoneNormalized: `+79991234${String(sequence).padStart(3, "0")}`,
          phoneDisplay: `+7 999 123-4${String(sequence).padStart(3, "0")}`,
          preferredContactChannel: "none",
          messengerAccounts: [],
          consentVersion: "public-booking-v1",
          consentAcceptedAt: "2026-08-02T09:00:00.000Z",
          status: "active",
          createdAt: "2026-08-02T09:00:00.000Z",
          updatedAt: "2026-08-02T09:00:00.000Z",
        });
        workspace.children.push({
          id: childId,
          organizationId: workspace.organization.id,
          familyId,
          displayName: `Лев ${index + 1}`,
          birthDate: "2020-08-03",
          status: "active",
          createdAt: "2026-08-02T09:00:00.000Z",
          updatedAt: "2026-08-02T09:00:00.000Z",
        });
        workspace.bookings.push({
          id,
          organizationId: workspace.organization.id,
          familyId,
          representativeId,
          childId,
          lessonRef,
          applicant: {
            parentName: "Мария",
            phoneNormalized: "+79991234567",
            phoneDisplay: "+7 999 123-45-67",
            childName: `Лев ${index + 1}`,
            childBirthDate: "2020-08-03",
            consentVersion: "public-booking-v1",
            consentAcceptedAt: "2026-08-02T09:00:00.000Z",
            preferredContactChannel: "none",
          },
          status: "confirmed",
          transferRequest: null,
          managementTokenDigest: nextDigest(),
          idempotencyKeyDigest: nextDigest(),
          visitKind: "trial",
          source: {
            surface: "standalone",
            purpose: "trial",
            channel: "website",
          },
          createdBy: "public-booking",
          createdAt: "2026-08-02T09:00:00.000Z",
          updatedAt: "2026-08-02T09:00:00.000Z",
        });
      }
      workspace.revision += 1;
      window.localStorage.setItem(storageKey, JSON.stringify(workspace));
    },
    { storageKey: BOOKING_STORAGE_KEY, lessonRef, count },
  );
}

async function answerConfirm(
  page: Page,
  action: () => Promise<unknown>,
  accept: boolean,
): Promise<string> {
  const dialogPromise = page.waitForEvent("dialog");
  const actionPromise = action();
  const dialog = await dialogPromise;
  const message = dialog.message();
  if (accept) await dialog.accept();
  else await dialog.dismiss();
  await actionPromise;
  return message;
}

test.beforeEach(async ({ page }) => {
  await installMockBridge(page);
});

test("AirHop schedule is embedded beside the existing collaboration navigation", async ({
  page,
}) => {
  await page.goto("/#/booking/schedule");

  await expect(
    page.getByTestId("airhop-sidebar-nav").getByText("AirHop", { exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId("open-airhop-schedule")).toHaveAttribute(
    "data-active",
    "true",
  );
  await expect(page.getByRole("heading", { name: "Расписание" })).toBeVisible();
  await expect(page.getByTestId("airhop-schedule-grid")).toBeVisible();
  await expect(page.locator('[data-testid^="airhop-lesson-"]')).toHaveCount(14);
  await expect(page.getByText("Без ограничений").first()).toBeVisible();
  await expect(page.getByText("Перенесено")).toBeVisible();
  await expect(page.getByText("Отменено")).toBeVisible();

  const branchFilter = page.getByTestId("airhop-branch-filter");
  await expect(branchFilter).toHaveCSS("appearance", "none");
  await branchFilter.selectOption("kurskaya");
  await expect(page.locator('[data-testid^="airhop-lesson-"]')).toHaveCount(7);

  const firstLesson = page.locator('[data-testid^="airhop-lesson-"]').first();
  await firstLesson.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("airhop-lesson-details")).toBeVisible();
});

test("AirHop keeps daily work in the sidebar and catalogs inside settings", async ({
  page,
}) => {
  await page.goto("/#/booking/schedule");

  const sidebar = page.getByTestId("airhop-sidebar-nav");
  for (const testId of [
    "open-airhop-schedule",
    "open-airhop-requests",
    "open-airhop-clients",
    "open-airhop-payments",
    "open-airhop-settings",
  ]) {
    await expect(sidebar.getByTestId(testId)).toBeVisible();
  }
  for (const testId of [
    "open-airhop-branches",
    "open-airhop-groups",
    "open-airhop-tariffs",
    "open-airhop-teachers",
  ]) {
    await expect(sidebar.getByTestId(testId)).toHaveCount(0);
  }

  await sidebar.getByTestId("open-airhop-settings").click();
  const settingsNav = page.getByTestId("airhop-settings-nav");
  for (const testId of [
    "open-airhop-settings-organization",
    "open-airhop-branches",
    "open-airhop-groups",
    "open-airhop-tariffs",
    "open-airhop-teachers",
    "open-airhop-settings-public-booking",
  ]) {
    await expect(settingsNav.getByTestId(testId)).toBeVisible();
  }

  const locale = page.getByTestId("airhop-settings-locale");
  await expect(locale.locator("option")).toHaveText(["Русский", "Английский"]);
  await expect(locale).toBeEnabled();
  await expect(
    page.getByText(
      "В первом MVP доступен русский. Архитектура готова к следующим словарям.",
    ),
  ).toHaveCount(0);
  await expect(
    page.getByText("Число месяца оплаты по умолчанию", { exact: true }),
  ).toBeVisible();

  await settingsNav.getByTestId("open-airhop-settings-public-booking").click();
  await expect(page).toHaveURL(/#\/booking\/settings\?section=public-booking$/);
  await expect(
    page.getByRole("heading", { name: "Публичная запись" }),
  ).toBeVisible();
  await expect(page.getByTestId("airhop-settings-public-preview")).toHaveCount(
    0,
  );

  await page.setViewportSize({ width: 426, height: 704 });
  await page.goto("/#/booking/settings");
  await expect(page.getByTestId("airhop-settings-nav")).toBeVisible();
  expect(
    await page
      .locator("body")
      .evaluate((element) => element.scrollWidth - element.clientWidth),
  ).toBeLessThanOrEqual(1);
});

test("AirHop settings and archived branches survive a browser preview reload", async ({
  page,
}) => {
  await page.goto("/#/booking/settings");

  const organizationName = page.getByTestId("airhop-settings-name");
  await organizationName.fill("AirHop Север");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByTestId("airhop-settings-saved")).toContainText(
    "Настройки сохранены",
  );

  await page.getByTestId("open-airhop-branches").click();
  await expect(page.getByRole("heading", { name: "Филиалы" })).toBeVisible();
  await page.getByTestId("airhop-add-branch").click();
  const form = page.getByTestId("airhop-branch-form");
  await form.getByTestId("airhop-branch-name").fill("Северный");
  await form
    .getByTestId("airhop-branch-address")
    .fill("Ленинградский проспект, 10");
  const channelInput = form.getByTestId("airhop-branch-channel");
  await expect(form.getByTestId("airhop-branch-channel-prefix")).toHaveText(
    "#",
  );
  await channelInput.fill("#general");
  await expect(form.getByTestId("airhop-branch-channel-status")).toContainText(
    "Найден канал #general",
  );
  await channelInput.fill("Северный-клиенты");
  await expect(form.getByTestId("airhop-branch-channel-status")).toContainText(
    "будет создан при сохранении",
  );

  const monday = form.getByTestId("airhop-hours-monday");
  await monday.getByRole("button", { name: "Добавить интервал" }).click();
  await monday.locator('input[type="time"]').nth(2).fill("17:00");
  await expect(form.getByText("Интервалы пересекаются")).toBeVisible();
  await form.getByLabel(/Я понимаю и хочу сохранить/).click();
  await form.getByRole("button", { name: "Сохранить" }).click();

  const createdBranch = page.getByText("Северный", { exact: true });
  await expect(createdBranch).toBeVisible();
  const card = page.getByTestId(/airhop-branch-branch-/).filter({
    hasText: "Северный",
  });
  await expect(card).toContainText("#Северный-клиенты");
  await card.getByRole("button", { name: "Архивировать" }).click();
  const archiveDialog = page.getByTestId("airhop-archive-branch-dialog");
  await archiveDialog.getByRole("button", { name: "Архивировать" }).click();
  await expect(card).toContainText("В архиве");

  await page.reload();
  await expect(page.getByText("Северный", { exact: true })).toBeVisible();
  await expect(
    page.getByTestId(/airhop-branch-branch-/).filter({ hasText: "Северный" }),
  ).toContainText("В архиве");

  await page.getByTestId("open-airhop-settings").click();
  await expect(page.getByTestId("airhop-settings-name")).toHaveValue(
    "AirHop Север",
  );
});

test("AirHop settings use a time zone select and persist its value", async ({
  page,
}) => {
  await page.goto("/#/booking/settings");

  const timeZone = page.getByTestId("airhop-settings-time-zone");
  expect(await timeZone.evaluate((element) => element.tagName)).toBe("SELECT");
  await expect(timeZone).toHaveCSS("appearance", "none");
  await expect(timeZone.locator('option[value="__auto__"]')).toContainText(
    "Определить автоматически",
  );
  await timeZone.selectOption("Asia/Tokyo");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByTestId("airhop-settings-saved")).toBeVisible();

  await page.reload();
  await expect(timeZone).toHaveValue("Asia/Tokyo");
});

test("single visits inherit from center and can be overridden for a group and lesson", async ({
  page,
}) => {
  await page.goto("/#/booking/settings");

  const centerSingleVisits = page.getByTestId("airhop-settings-single-visits");
  await expect(centerSingleVisits).not.toBeChecked();
  await centerSingleVisits.click();
  await page.getByRole("button", { name: "Сохранить" }).click();

  await page.getByTestId("open-airhop-groups").click();
  const groupCard = page.getByTestId("airhop-group-robotics-junior");
  await groupCard.getByRole("button", { name: "Редактировать" }).click();
  let groupForm = page.getByTestId("airhop-group-form");
  const groupSingleVisits = groupForm.getByTestId("airhop-group-single-visits");
  await expect(groupSingleVisits).toHaveValue("inherit");
  await groupSingleVisits.selectOption("disabled");
  await groupForm.getByRole("button", { name: "Сохранить" }).click();

  await groupCard.getByRole("button", { name: "Редактировать" }).click();
  groupForm = page.getByTestId("airhop-group-form");
  await expect(groupForm.getByTestId("airhop-group-single-visits")).toHaveValue(
    "disabled",
  );
  await groupForm.getByRole("button", { name: "Отмена" }).click();

  await page.getByTestId("open-airhop-schedule").click();
  const lesson = page.getByTestId(
    "airhop-lesson-robotics-junior-weekly:2026-08-03",
  );
  await lesson.click();
  await page.getByTestId("airhop-edit-lesson").click();
  let editor = page.getByTestId("airhop-lesson-edit-dialog");
  const lessonSingleVisits = editor.getByTestId("airhop-lesson-single-visits");
  await expect(lessonSingleVisits).toHaveValue("inherit");
  await lessonSingleVisits.selectOption("enabled");
  await editor.getByRole("button", { name: "Сохранить" }).click();

  await lesson.click();
  await page.getByTestId("airhop-edit-lesson").click();
  editor = page.getByTestId("airhop-lesson-edit-dialog");
  await expect(editor.getByTestId("airhop-lesson-single-visits")).toHaveValue(
    "enabled",
  );
});

test("AirHop branch form scrolls its fields while keeping actions visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_200, height: 520 });
  await page.goto("/#/booking/settings");
  await page.getByTestId("open-airhop-branches").click();

  await page.getByTestId("airhop-add-branch").click();
  const form = page.getByTestId("airhop-branch-form");
  const scrollRegion = form.getByTestId("airhop-branch-form-scroll");
  const actions = form.getByRole("button", { name: "Сохранить" });

  const dimensions = await scrollRegion.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  await expect(actions).toBeVisible();

  await scrollRegion.hover();
  await page.mouse.wheel(0, 600);
  await expect
    .poll(() => scrollRegion.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(actions).toBeVisible();
});

test("active branches copy a branch-specific public booking URL", async ({
  context,
  page,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/#/booking/branches");

  await page.getByTestId("airhop-copy-booking-link-kurskaya").click();
  await expect(page.getByTestId("airhop-branch-link-feedback")).toContainText(
    "Ссылка записи для «Курская» скопирована",
  );
  const expectedUrl = `${new URL(page.url()).origin}/#/booking?branchId=kurskaya`;
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(expectedUrl);
});

test("AirHop manages branch rooms and preserves archived group links", async ({
  page,
}) => {
  await page.goto("/#/booking/branches");
  const branchCard = page.getByTestId("airhop-branch-kurskaya");
  await branchCard.getByRole("button", { name: "Кабинеты" }).click();
  let roomsDialog = page.getByTestId("airhop-rooms-dialog");
  await roomsDialog.getByRole("button", { name: "Добавить кабинет" }).click();

  let roomForm = page.getByTestId("airhop-room-form");
  const roomName = roomForm.getByTestId("airhop-room-name");
  await roomName.fill("Несохранённый кабинет");
  const dirtyPrompt = await answerConfirm(
    page,
    () => roomForm.getByRole("button", { name: "Close" }).click(),
    false,
  );
  expect(dirtyPrompt).toContain("несохранённые изменения");
  await expect(roomForm).toBeVisible();
  await roomName.fill("Студия тестов");
  await roomForm.getByRole("button", { name: "Сохранить" }).click();

  let roomCard = roomsDialog
    .locator('[data-testid^="airhop-room-"]')
    .filter({ hasText: "Студия тестов" });
  await expect(roomCard).toBeVisible();
  const roomTestId = await roomCard.getAttribute("data-testid");
  expect(roomTestId).toBeTruthy();

  await roomCard.getByRole("button", { name: "Редактировать" }).click();
  roomForm = page.getByTestId("airhop-room-form");
  await roomForm.getByTestId("airhop-room-name").fill("Студия тестов 2");
  await page.evaluate(
    ({ storageKey, testId }) => {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) throw new Error("Booking workspace was not persisted");
      const workspace = JSON.parse(raw);
      const roomId = testId.replace("airhop-room-", "");
      const room = workspace.rooms.find(
        (candidate: { id: string }) => candidate.id === roomId,
      );
      if (!room) throw new Error("Booking room was not found");
      workspace.revision += 1;
      room.name = "Свежая внешняя версия";
      window.localStorage.setItem(storageKey, JSON.stringify(workspace));
    },
    { storageKey: BOOKING_STORAGE_KEY, testId: roomTestId },
  );
  await roomForm.getByRole("button", { name: "Сохранить" }).click();
  await expect(roomForm.getByTestId("airhop-revision-conflict")).toBeVisible();
  await expect(roomForm.getByTestId("airhop-room-name")).toHaveValue(
    "Студия тестов 2",
  );
  await roomForm.getByRole("button", { name: "Сохранить" }).click();
  await expect(roomForm).toBeHidden();

  roomsDialog = page.getByTestId("airhop-rooms-dialog");
  roomCard = roomsDialog.getByTestId(roomTestId);
  await expect(roomCard).toContainText("Студия тестов 2");
  await roomsDialog.getByRole("button", { name: "Закрыть" }).click();

  await page.getByTestId("open-airhop-groups").click();
  const groupCard = page.getByTestId("airhop-group-robotics-junior");
  await groupCard.getByRole("button", { name: "Редактировать" }).click();
  let groupForm = page.getByTestId("airhop-group-form");
  await groupForm
    .getByTestId("airhop-group-room")
    .selectOption({ label: "Студия тестов 2" });
  await groupForm.getByRole("button", { name: "Сохранить" }).click();
  await expect(groupCard).toContainText("Студия тестов 2");

  await page.reload();
  await expect(groupCard).toContainText("Студия тестов 2");
  await page.getByTestId("open-airhop-branches").click();
  await branchCard.getByRole("button", { name: "Кабинеты" }).click();
  roomsDialog = page.getByTestId("airhop-rooms-dialog");
  roomCard = roomsDialog.getByTestId(roomTestId);
  await roomCard.getByRole("button", { name: "Архивировать" }).click();
  const archiveDialog = page.getByTestId("airhop-archive-room-dialog");
  await expect(archiveDialog).toContainText("активных");
  await archiveDialog.getByRole("button", { name: "Архивировать" }).click();
  await expect(roomCard).toContainText("В архиве");
  await roomsDialog.getByRole("button", { name: "Закрыть" }).click();

  await page.getByTestId("open-airhop-groups").click();
  await groupCard.getByRole("button", { name: "Редактировать" }).click();
  groupForm = page.getByTestId("airhop-group-form");
  await expect(groupForm.getByTestId("airhop-group-room")).toHaveValue(
    roomTestId.replace("airhop-room-", ""),
  );
  await expect(
    groupForm.getByTestId("airhop-group-room").locator("option:checked"),
  ).toContainText("в архиве");
  await groupForm.getByRole("button", { name: "Close" }).click();

  await page.getByTestId("airhop-add-group").click();
  groupForm = page.getByTestId("airhop-group-form");
  await expect(
    groupForm.getByTestId("airhop-group-room").locator("option", {
      hasText: "Студия тестов 2",
    }),
  ).toHaveCount(0);
});

test("AirHop protects dirty settings and branch dialogs", async ({ page }) => {
  await page.goto("/#/booking/settings");

  await page.getByTestId("airhop-settings-name").fill("Несохранённый центр");
  const settingsPrompt = await answerConfirm(
    page,
    () => page.getByTestId("open-airhop-branches").click(),
    false,
  );
  expect(settingsPrompt).toContain("несохранённые изменения");
  await expect(
    page.getByRole("heading", { name: "Настройки AirHop" }),
  ).toBeVisible();

  await answerConfirm(
    page,
    () => page.getByTestId("open-airhop-branches").click(),
    true,
  );
  await expect(page.getByRole("heading", { name: "Филиалы" })).toBeVisible();

  const firstBranch = page.locator('[data-testid^="airhop-branch-"]').first();
  await firstBranch.getByRole("button", { name: "Редактировать" }).click();
  const form = page.getByTestId("airhop-branch-form");
  await form.getByTestId("airhop-branch-name").fill("Несохранённый филиал");

  for (const close of [
    () => form.getByRole("button", { name: "Отмена" }).click(),
    () => form.getByRole("button", { name: "Close" }).click(),
    () =>
      page.getByTestId("dialog-overlay").click({ position: { x: 4, y: 4 } }),
  ]) {
    const prompt = await answerConfirm(page, close, false);
    expect(prompt).toContain("несохранённые изменения");
    await expect(form).toBeVisible();
  }

  await answerConfirm(
    page,
    () => form.getByRole("button", { name: "Close" }).click(),
    true,
  );
  await expect(form).toBeHidden();
});

test("AirHop reloads fresh settings and branch drafts after revision conflicts", async ({
  page,
}) => {
  await page.goto("/#/booking/settings");

  const organizationName = page.getByTestId("airhop-settings-name");
  await organizationName.fill("Базовая версия");
  await page.getByRole("button", { name: "Сохранить" }).click();
  await expect(page.getByTestId("airhop-settings-saved")).toBeVisible();

  await organizationName.fill("Устаревший черновик");
  await page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) throw new Error("Booking workspace was not persisted");
    const workspace = JSON.parse(raw);
    workspace.revision += 1;
    workspace.organization.name = "Свежая версия";
    window.localStorage.setItem(storageKey, JSON.stringify(workspace));
  }, BOOKING_STORAGE_KEY);
  await page.getByRole("button", { name: "Сохранить" }).click();

  await expect(page.getByTestId("airhop-revision-conflict")).toBeVisible();
  await expect(organizationName).toHaveValue("Свежая версия");
  await expect(page.getByRole("button", { name: "Сохранить" })).toBeDisabled();

  await page.getByTestId("open-airhop-branches").click();
  const firstBranch = page.locator('[data-testid^="airhop-branch-"]').first();
  await firstBranch.getByRole("button", { name: "Редактировать" }).click();
  const form = page.getByTestId("airhop-branch-form");
  const branchName = form.getByTestId("airhop-branch-name");
  const originalBranchName = await branchName.inputValue();
  await branchName.fill("Устаревший филиал");
  const freshBranchName = `${originalBranchName} свежий`;
  await page.evaluate(
    ({ freshName, originalName, storageKey }) => {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) throw new Error("Booking workspace was not persisted");
      const workspace = JSON.parse(raw);
      const branch = workspace.branches.find(
        (candidate: { name: string }) => candidate.name === originalName,
      );
      if (!branch) throw new Error("Booking branch was not found");
      workspace.revision += 1;
      branch.name = freshName;
      window.localStorage.setItem(storageKey, JSON.stringify(workspace));
    },
    {
      freshName: freshBranchName,
      originalName: originalBranchName,
      storageKey: BOOKING_STORAGE_KEY,
    },
  );
  await form.getByRole("button", { name: "Сохранить" }).click();

  await expect(form.getByTestId("airhop-revision-conflict")).toBeVisible();
  await expect(branchName).toHaveValue(freshBranchName);
  await expect(form.getByRole("button", { name: "Сохранить" })).toBeDisabled();
});

test("AirHop manages teachers and groups without losing archived history", async ({
  page,
}) => {
  await page.goto("/#/booking/teachers");

  await page.getByTestId("airhop-add-teacher").click();
  let teacherForm = page.getByTestId("airhop-teacher-form");
  await teacherForm.getByTestId("airhop-teacher-name").fill("Ксения Тестова");
  await teacherForm
    .getByTestId("airhop-teacher-buzz-username")
    .fill("ksenia.test");
  await teacherForm.getByRole("button", { name: "Сохранить" }).click();

  const teacherCard = page
    .locator('[data-testid^="airhop-teacher-"]')
    .filter({ hasText: "Ксения Тестова" });
  await expect(teacherCard).toContainText("ksenia.test");
  await teacherCard.getByRole("button", { name: "Редактировать" }).click();
  teacherForm = page.getByTestId("airhop-teacher-form");
  await teacherForm
    .getByTestId("airhop-teacher-name")
    .fill("Ксения Тестова-Старшая");
  await teacherForm.getByRole("button", { name: "Сохранить" }).click();
  await expect(teacherCard).toContainText("Ксения Тестова-Старшая");

  await teacherCard.getByRole("button", { name: "Архивировать" }).click();
  await page
    .getByTestId("airhop-archive-teacher-dialog")
    .getByRole("button", { name: "Архивировать" })
    .click();
  await expect(teacherCard).toContainText("В архиве");

  await page.getByTestId("open-airhop-groups").click();
  await page.getByTestId("airhop-add-group").click();
  let groupForm = page.getByTestId("airhop-group-form");
  await expect(groupForm.getByLabel("Ксения Тестова-Старшая")).toHaveCount(0);
  await groupForm.getByTestId("airhop-group-name").fill("Клуб тестировщиков");
  await groupForm.getByTestId("airhop-group-room").selectOption({
    label: "Лаборатория 1",
  });
  await groupForm.getByLabel("Анна Орлова", { exact: true }).click();
  await groupForm.getByTestId("airhop-group-min-age").fill("71");
  await groupForm.getByTestId("airhop-group-trial-policy").selectOption("paid");
  await groupForm.getByLabel("Валюта").fill("RUB");
  await groupForm.getByLabel("Стоимость").fill("750");
  await groupForm
    .getByTestId("airhop-group-attendance")
    .selectOption("disabled");

  const firstTemplate = groupForm.getByTestId("airhop-group-schedule-0");
  await firstTemplate.getByLabel("Начало 1").fill("2026-08-03");
  await groupForm.getByRole("button", { name: "Добавить занятие" }).click();
  const secondTemplate = groupForm.getByTestId("airhop-group-schedule-1");
  await secondTemplate.getByLabel("Понедельник 2").click();
  await secondTemplate.getByLabel("Четверг 2").click();
  await secondTemplate.getByLabel("С 2").fill("16:00");
  await secondTemplate.getByLabel("До 2").fill("17:00");

  const conflicts = groupForm.getByTestId("airhop-group-schedule-conflicts");
  await expect(conflicts).toContainText("Кабинет уже занят");
  await expect(conflicts).toContainText("Преподаватель уже занят");
  await groupForm
    .getByLabel("Я проверил конфликты и хочу сохранить расписание")
    .click();
  await groupForm.getByRole("button", { name: "Сохранить" }).click();

  const groupCard = page
    .locator('[data-testid^="airhop-group-"]')
    .filter({ hasText: "Клуб тестировщиков" });
  await expect(groupCard).toContainText("Шаблонов расписания: 2");
  await expect(groupCard).toContainText("Вместимость без ограничений");
  await expect(groupCard).toContainText("Посещаемость: Выключен");

  await page.getByTestId("open-airhop-schedule").click();
  const lesson = page
    .locator('[data-testid^="airhop-lesson-"]')
    .filter({ hasText: "Клуб тестировщиков" });
  await expect(lesson.first()).toBeVisible();
  await expect(lesson.first()).not.toContainText("750");

  await page.getByTestId("open-airhop-settings").click();
  await page.getByTestId("open-airhop-groups").click();
  await groupCard.getByRole("button", { name: "Редактировать" }).click();
  groupForm = page.getByTestId("airhop-group-form");
  await groupForm.getByTestId("airhop-group-name").fill("Клуб тестировщиков 2");
  await groupForm
    .getByTestId("airhop-group-schedule-1")
    .getByRole("button", { name: "Удалить занятие" })
    .click();
  await groupForm
    .getByLabel("Я проверил конфликты и хочу сохранить расписание")
    .click();
  await groupForm.getByRole("button", { name: "Сохранить" }).click();
  await expect(groupCard).toContainText("Шаблонов расписания: 1");

  await groupCard.getByRole("button", { name: "Архивировать" }).click();
  await page
    .getByTestId("airhop-archive-group-dialog")
    .getByRole("button", { name: "Архивировать" })
    .click();
  await expect(groupCard).toContainText("В архиве");

  const history = await page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) throw new Error("Booking workspace was not persisted");
    const workspace = JSON.parse(raw);
    const group = workspace.groups.find(
      (candidate: { name: string }) =>
        candidate.name === "Клуб тестировщиков 2",
    );
    const rules = workspace.recurrenceRules.filter(
      (rule: { groupId: string }) => rule.groupId === group.id,
    );
    return {
      groupStatus: group.status,
      activeRules: rules.filter(
        (rule: { status: string }) => rule.status === "active",
      ).length,
      archivedRules: rules.filter(
        (rule: { status: string }) => rule.status === "archived",
      ).length,
    };
  }, BOOKING_STORAGE_KEY);
  expect(history).toEqual({
    groupStatus: "archived",
    activeRules: 1,
    archivedRules: 1,
  });

  await page.reload();
  await expect(groupCard).toContainText("В архиве");
  await groupCard.getByRole("button", { name: "Восстановить" }).click();
  await expect(groupCard).toContainText("Активен");

  await page.getByTestId("open-airhop-teachers").click();
  await expect(teacherCard).toContainText("В архиве");
  await teacherCard.getByRole("button", { name: "Восстановить" }).click();
  await expect(teacherCard).toContainText("Активен");
});

test("AirHop protects dirty teacher and group drafts", async ({ page }) => {
  await page.goto("/#/booking/teachers");

  await page.getByTestId("airhop-add-teacher").click();
  const teacherForm = page.getByTestId("airhop-teacher-form");
  await teacherForm
    .getByTestId("airhop-teacher-name")
    .fill("Несохранённый преподаватель");
  const teacherPrompt = await answerConfirm(
    page,
    () => teacherForm.getByRole("button", { name: "Close" }).click(),
    false,
  );
  expect(teacherPrompt).toContain("несохранённые изменения");
  await expect(teacherForm).toBeVisible();

  await answerConfirm(
    page,
    () => teacherForm.getByRole("button", { name: "Close" }).click(),
    true,
  );
  await page.getByTestId("open-airhop-groups").click();
  await expect(page.getByRole("heading", { name: "Группы" })).toBeVisible();

  await page.getByTestId("airhop-add-group").click();
  const groupForm = page.getByTestId("airhop-group-form");
  await groupForm.getByTestId("airhop-group-name").fill("Несохранённая группа");
  const groupPrompt = await answerConfirm(
    page,
    () => groupForm.getByRole("button", { name: "Close" }).click(),
    false,
  );
  expect(groupPrompt).toContain("несохранённые изменения");
  await expect(groupForm).toBeVisible();

  await answerConfirm(
    page,
    () => groupForm.getByRole("button", { name: "Close" }).click(),
    true,
  );
  await expect(groupForm).toBeHidden();
});

test("AirHop reloads fresh teacher and group drafts after revision conflicts", async ({
  page,
}) => {
  await page.goto("/#/booking/teachers");

  const teacherCard = page.getByTestId("airhop-teacher-teacher-1");
  await teacherCard.getByRole("button", { name: "Редактировать" }).click();
  let teacherForm = page.getByTestId("airhop-teacher-form");
  let teacherName = teacherForm.getByTestId("airhop-teacher-name");
  await teacherName.fill("Анна Орлова базовая");
  await teacherForm.getByRole("button", { name: "Сохранить" }).click();

  await teacherCard.getByRole("button", { name: "Редактировать" }).click();
  teacherForm = page.getByTestId("airhop-teacher-form");
  teacherName = teacherForm.getByTestId("airhop-teacher-name");
  await teacherName.fill("Устаревший преподаватель");
  await page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) throw new Error("Booking workspace was not persisted");
    const workspace = JSON.parse(raw);
    workspace.revision += 1;
    workspace.teachers.find(
      (teacher: { id: string }) => teacher.id === "teacher-1",
    ).displayName = "Свежий преподаватель";
    window.localStorage.setItem(storageKey, JSON.stringify(workspace));
  }, BOOKING_STORAGE_KEY);
  await teacherForm.getByRole("button", { name: "Сохранить" }).click();

  await expect(
    teacherForm.getByTestId("airhop-revision-conflict"),
  ).toBeVisible();
  await expect(teacherName).toHaveValue("Свежий преподаватель");
  await expect(
    teacherForm.getByRole("button", { name: "Сохранить" }),
  ).toBeDisabled();
  await teacherForm.getByRole("button", { name: "Закрыть" }).click();
  await teacherForm.getByRole("button", { name: "Close" }).click();

  await page.getByTestId("open-airhop-groups").click();
  const groupCard = page.getByTestId("airhop-group-robotics-junior");
  await groupCard.getByRole("button", { name: "Редактировать" }).click();
  let groupForm = page.getByTestId("airhop-group-form");
  let groupName = groupForm.getByTestId("airhop-group-name");
  await groupName.fill("Робототехника базовая");
  await groupForm.getByRole("button", { name: "Сохранить" }).click();

  await groupCard.getByRole("button", { name: "Редактировать" }).click();
  groupForm = page.getByTestId("airhop-group-form");
  groupName = groupForm.getByTestId("airhop-group-name");
  await groupName.fill("Устаревшая группа");
  await page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) throw new Error("Booking workspace was not persisted");
    const workspace = JSON.parse(raw);
    workspace.revision += 1;
    workspace.groups.find(
      (group: { id: string }) => group.id === "robotics-junior",
    ).name = "Свежая группа";
    window.localStorage.setItem(storageKey, JSON.stringify(workspace));
  }, BOOKING_STORAGE_KEY);
  await groupForm.getByRole("button", { name: "Сохранить" }).click();

  await expect(groupForm.getByTestId("airhop-revision-conflict")).toBeVisible();
  await expect(groupName).toHaveValue("Свежая группа");
  await expect(
    groupForm.getByRole("button", { name: "Сохранить" }),
  ).toBeDisabled();
});

test("AirHop cancels, moves and restores one lesson without changing its series", async ({
  page,
}) => {
  await page.goto("/#/booking/schedule");
  const originalLesson = page.getByTestId(
    "airhop-lesson-robotics-junior-weekly:2026-08-03",
  );
  await originalLesson.click();
  let details = page.getByTestId("airhop-lesson-details");
  await details.getByTestId("airhop-cancel-lesson").click();
  const cancelDialog = page.getByTestId("airhop-cancel-lesson-dialog");
  await expect(cancelDialog).toContainText(
    "Остальные занятия серии не изменятся",
  );
  await cancelDialog.getByRole("button", { name: "Отменить занятие" }).click();
  await expect(originalLesson).toContainText("Отменено");

  await page.reload();
  await expect(originalLesson).toContainText("Отменено");
  await originalLesson.click();
  details = page.getByTestId("airhop-lesson-details");
  await details.getByTestId("airhop-restore-lesson").click();
  await page
    .getByTestId("airhop-restore-lesson-dialog")
    .getByRole("button", { name: "Вернуть значения серии" })
    .click();
  await expect(originalLesson).not.toContainText("Отменено");

  await persistConfirmedBookings(
    page,
    {
      recurrenceRuleId: "robotics-junior-weekly",
      originalDate: "2026-08-03",
    },
    3,
  );
  await page.reload();
  await expect(originalLesson).toContainText("5 мест свободно");

  await originalLesson.click();
  details = page.getByTestId("airhop-lesson-details");
  await expect(details).toContainText("3 из 8 занято");
  await details.getByTestId("airhop-edit-lesson").click();
  const editDialog = page.getByTestId("airhop-lesson-edit-dialog");
  await editDialog.getByTestId("airhop-lesson-date").fill("2026-08-11");
  await editDialog.getByTestId("airhop-lesson-start-time").fill("07:00");
  await editDialog.getByTestId("airhop-lesson-end-time").fill("08:00");
  await editDialog
    .getByTestId("airhop-lesson-capacity-mode")
    .selectOption("limited");
  await editDialog.getByTestId("airhop-lesson-capacity-limit").fill("5");
  await editDialog
    .getByTestId("airhop-lesson-trial-policy")
    .selectOption("paid");
  await editDialog.getByTestId("airhop-lesson-trial-currency").fill("RUB");
  await editDialog.getByTestId("airhop-lesson-trial-price").fill("750");
  await expect(
    editDialog.getByTestId("airhop-lesson-change-preview"),
  ).toContainText("только это занятие");
  await expect(
    editDialog.getByTestId("airhop-lesson-change-preview"),
  ).toContainText("Вместимость:");
  await expect(
    editDialog.getByTestId("airhop-lesson-change-preview"),
  ).toContainText("Пробное:");
  const conflicts = editDialog.getByTestId("airhop-lesson-conflicts");
  await expect(conflicts).toContainText("выходит за рабочее время");
  await expect(
    editDialog.getByRole("button", { name: "Сохранить" }),
  ).toBeDisabled();
  await editDialog
    .getByLabel("Я проверил конфликты и хочу изменить одно занятие")
    .click();
  await page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) throw new Error("Booking workspace was not persisted");
    const workspace = JSON.parse(raw);
    workspace.revision += 1;
    workspace.organization.name = "Свежая внешняя версия AirHop";
    window.localStorage.setItem(storageKey, JSON.stringify(workspace));
  }, BOOKING_STORAGE_KEY);
  await editDialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(
    editDialog.getByTestId("airhop-revision-conflict"),
  ).toBeVisible();
  await expect(editDialog.getByTestId("airhop-lesson-date")).toHaveValue(
    "2026-08-11",
  );
  await expect(editDialog.getByTestId("airhop-lesson-start-time")).toHaveValue(
    "07:00",
  );
  await expect(
    editDialog.getByTestId("airhop-lesson-capacity-limit"),
  ).toHaveValue("5");
  await expect(editDialog.getByTestId("airhop-lesson-trial-price")).toHaveValue(
    "750",
  );
  await editDialog.getByRole("button", { name: "Сохранить" }).click();
  await expect(originalLesson).toHaveCount(0);

  await page.getByRole("button", { name: "Следующая неделя" }).click();
  const movedLesson = page
    .locator('[data-testid^="airhop-lesson-"]')
    .filter({ hasText: "Робототехника Junior" })
    .filter({ hasText: "07:00–08:00" });
  const regularLesson = page
    .locator('[data-testid^="airhop-lesson-"]')
    .filter({ hasText: "Робототехника Junior" })
    .filter({ hasText: "10:00–11:00" });
  await expect(movedLesson).toContainText("Перенесено");
  await expect(movedLesson).not.toContainText("750");
  await expect(regularLesson).toBeVisible();
  await expect(regularLesson).not.toContainText("Перенесено");
  await movedLesson.click();
  details = page.getByTestId("airhop-lesson-details");
  await expect(details).toContainText("Перенесено с 3 августа, 10:00–11:00");
  await expect(details).toContainText("3 из 5 занято");
  await expect(details).toContainText("750");
  await details.getByTestId("airhop-edit-lesson").click();
  await expect(
    editDialog.getByTestId("airhop-lesson-capacity-mode"),
  ).toHaveValue("limited");
  await expect(
    editDialog.getByTestId("airhop-lesson-capacity-limit"),
  ).toHaveValue("5");
  await expect(
    editDialog.getByTestId("airhop-lesson-trial-policy"),
  ).toHaveValue("paid");
  await expect(editDialog.getByTestId("airhop-lesson-trial-price")).toHaveValue(
    "750.00",
  );
  await editDialog.getByRole("button", { name: "Отмена" }).click();
  await movedLesson.click();
  details = page.getByTestId("airhop-lesson-details");
  await details.getByTestId("airhop-cancel-lesson").click();
  const movedCancelDialog = page.getByTestId("airhop-cancel-lesson-dialog");
  await expect(movedCancelDialog).toContainText("11 августа");
  await expect(movedCancelDialog).toContainText("07:00–08:00");
  await movedCancelDialog
    .getByRole("button", { name: "Отменить занятие" })
    .click();
  await expect(movedLesson).toContainText("Отменено");
  await expect(regularLesson).toBeVisible();
  await expect(regularLesson).not.toContainText("Отменено");

  await page.reload();
  await page.getByRole("button", { name: "Следующая неделя" }).click();
  await expect(movedLesson).toContainText("Отменено");
  await expect(movedLesson).toContainText("07:00–08:00");
  await expect(regularLesson).toBeVisible();
  await movedLesson.click();
  details = page.getByTestId("airhop-lesson-details");
  await expect(details).toContainText("Перенесено с 3 августа, 10:00–11:00");
  await expect(details).toContainText("0 из 5 занято");
  await expect(details).toContainText("750");
  await details.getByTestId("airhop-restore-lesson").click();
  await page
    .getByTestId("airhop-restore-lesson-dialog")
    .getByRole("button", { name: "Вернуть значения серии" })
    .click();
  await expect(movedLesson).toHaveCount(0);
  await expect(regularLesson).toBeVisible();

  await page.getByRole("button", { name: "Предыдущая неделя" }).click();
  await expect(originalLesson).toBeVisible();
  await expect(originalLesson).not.toContainText("Перенесено");
  await originalLesson.click();
  details = page.getByTestId("airhop-lesson-details");
  await expect(details).toContainText("0 из 8 занято");
  await expect(details).toContainText("Пробное: бесплатно");
});

test("AirHop removes one lesson override without discarding its other changes", async ({
  page,
}) => {
  await page.goto("/#/booking/schedule");
  const lesson = page.getByTestId(
    "airhop-lesson-robotics-junior-weekly:2026-08-03",
  );
  await lesson.click();
  await page.getByTestId("airhop-edit-lesson").click();
  let editor = page.getByTestId("airhop-lesson-edit-dialog");
  await editor
    .getByTestId("airhop-lesson-capacity-mode")
    .selectOption("limited");
  await editor.getByTestId("airhop-lesson-capacity-limit").fill("6");
  await editor.getByTestId("airhop-lesson-trial-policy").selectOption("paid");
  await editor.getByTestId("airhop-lesson-trial-currency").fill("RUB");
  await editor.getByTestId("airhop-lesson-trial-price").fill("900");
  await editor.getByRole("button", { name: "Сохранить" }).click();
  await expect(editor).toHaveCount(0);

  await persistConfirmedBookings(
    page,
    {
      recurrenceRuleId: "robotics-junior-weekly",
      originalDate: "2026-08-03",
    },
    3,
  );
  await page.reload();

  await lesson.click();
  let details = page.getByTestId("airhop-lesson-details");
  await expect(details).toContainText("3 из 6 занято");
  await expect(details).toContainText("900");
  await details.getByTestId("airhop-edit-lesson").click();
  editor = page.getByTestId("airhop-lesson-edit-dialog");
  await expect(editor.getByTestId("airhop-lesson-capacity-mode")).toHaveValue(
    "limited",
  );
  await expect(editor.getByTestId("airhop-lesson-trial-policy")).toHaveValue(
    "paid",
  );
  await editor
    .getByTestId("airhop-lesson-capacity-mode")
    .selectOption("inherit");
  await expect(
    editor.getByTestId("airhop-lesson-change-preview"),
  ).toContainText("Наследовать от серии (8 мест)");
  await editor.getByRole("button", { name: "Сохранить" }).click();

  await lesson.click();
  details = page.getByTestId("airhop-lesson-details");
  await expect(details).toContainText("3 из 8 занято");
  await expect(details).toContainText("900");
  const savedException = await page.evaluate((storageKey) => {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) throw new Error("Booking workspace was not persisted");
    const workspace = JSON.parse(raw);
    return workspace.lessonExceptions.filter(
      (exception: { originalDate: string; recurrenceRuleId: string }) =>
        exception.recurrenceRuleId === "robotics-junior-weekly" &&
        exception.originalDate === "2026-08-03",
    );
  }, BOOKING_STORAGE_KEY);
  expect(savedException).toHaveLength(1);
  expect(savedException[0].override).not.toHaveProperty("capacity");
  expect(savedException[0].override.trialPolicy).toEqual({
    mode: "paid",
    price: { amountMinor: 90_000, currency: "RUB" },
  });
});

test("AirHop lesson editor scrolls while keeping footer actions visible", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1_100, height: 520 });
  await page.goto("/#/booking/schedule");
  await page
    .getByTestId("airhop-lesson-robotics-junior-weekly:2026-08-03")
    .click();
  await page.getByTestId("airhop-edit-lesson").click();
  const dialog = page.getByTestId("airhop-lesson-edit-dialog");
  const scrollRegion = dialog.getByTestId("airhop-lesson-edit-scroll");
  const save = dialog.getByRole("button", { name: "Сохранить" });

  const dimensions = await scrollRegion.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(dimensions.scrollHeight).toBeGreaterThan(dimensions.clientHeight);
  await expect(save).toBeVisible();
  await scrollRegion.hover();
  await page.mouse.wheel(0, 500);
  await expect
    .poll(() => scrollRegion.evaluate((element) => element.scrollTop))
    .toBeGreaterThan(0);
  await expect(save).toBeVisible();
});

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  test(`schedule remains usable at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/#/booking/schedule");
    await expect(page.getByTestId("airhop-schedule-grid-scroll")).toBeVisible();
    await waitForAnimations(page);
    await expect(page.getByTestId("airhop-schedule-grid")).toBeVisible();
  });
}

for (const theme of ["buzz", "buzz-dark", "github-light"]) {
  test(`schedule uses semantic surfaces in ${theme}`, async ({ page }) => {
    await page.addInitScript((selectedTheme) => {
      window.localStorage.setItem("buzz-theme", selectedTheme);
    }, theme);
    await page.goto("/#/booking/schedule");
    await expect(page.getByTestId("airhop-schedule-grid")).toBeVisible();
    await waitForAnimations(page);
    await expect(
      page.getByRole("heading", { name: "Расписание" }),
    ).toBeVisible();
  });
}
