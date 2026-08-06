# AirHop Tariffs and Enrollments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build reusable tariffs, tariff-backed permanent enrollments with selected weekly slots, the first expected payment, payment operations, and visible child age across the AirHop admin UI and Fizz action contract.

**Architecture:** Booking Workspace advances to schema v8 and remains the single domain contract. Tariffs, configured enrollments, and payment expectations are validated in Booking Core; pure commerce mutations create the enrollment and first payment atomically; read models feed the family, group, lesson, tariff, and payment screens. Staff UI executes direct actions, while Fizz uses the same Action Service through 24-hour preview-and-confirm commands.

**Tech Stack:** TypeScript, React, TanStack Router, Zod, existing Buzz UI primitives, Node test runner, Playwright, Vite, Biome.

## Global Constraints

- Preserve all unrelated dirty-worktree changes and stage only files named by each task.
- Do not add dependencies.
- The same React screens must run in browser preview and the later Tauri build.
- Production data continues to flow through Booking Workspace repositories; demo storage remains preview-only.
- MVP copy is Russian, but every new label, date, money value, weekday, and age phrase goes through the existing locale layer.
- Permanent enrollment requires an active tariff and at least one selected weekly slot.
- A weekly slot is `{ recurrenceRuleId, weekday }`; a configured enrollment may select no more slots than `tariff.weeklyScheduleLimit`.
- Trial and permitted single visits remain Booking records and never require a tariff.
- The first PaymentExpectation is created atomically on the enrollment start date; recurring monthly generation, Buzz reminders, bank webhooks, documents, and pause billing are outside this plan.
- Staff UI changes execute directly. Fizz mutations require a preview, explicit confirmation, and expire after 24 hours.
- New dialogs and screens must work at 320 CSS pixels without horizontal overflow; E2E acceptance uses 351×704.
- Keep TypeScript modules focused; run `pnpm check:file-sizes` before completion.

---

## File Structure

### Domain and data

- `desktop/src/features/booking/model/bookingCore.ts` — v8 Zod schemas and exported types for tariffs, weekly selections, configured/legacy enrollments, and payments.
- `desktop/src/features/booking/model/bookingWorkspaceMigration.ts` — deterministic v7→v8 migration.
- `desktop/src/features/booking/model/bookingCommerce.ts` — focused tariff, enrollment, and payment validation/mutations.
- `desktop/src/features/booking/model/bookingOperations.ts` — lesson coverage and computed payment state.
- `desktop/src/features/booking/lib/bookingCommerceReadModels.ts` — family enrollment cards, tariff usage, and payment queue rows.
- `desktop/src/features/booking/actions/airhopActionSchemas.ts` — staff/Fizz commerce command contracts.
- `desktop/src/features/booking/actions/airhopActionService.ts` — atomic planning, preview, direct execution, and Fizz confirmation.
- `desktop/src/features/booking/model/demoSchedule.ts` — v8 demo defaults and reusable tariff fixtures.

### UI and routing

- `desktop/src/features/booking/ui/TariffFormDialog.tsx` — create/edit tariff form.
- `desktop/src/features/booking/ui/TariffsScreen.tsx` — active/archive tariff catalog.
- `desktop/src/features/booking/ui/EnrollmentDialog.tsx` — shared child/group/tariff/weekly-slot enrollment flow.
- `desktop/src/features/booking/ui/WeeklySchedulePicker.tsx` — accessible slot selection constrained by the tariff.
- `desktop/src/features/booking/ui/PaymentsScreen.tsx` — expected/overdue/paid/cancelled work queue.
- `desktop/src/features/booking/ui/PaymentActionDialog.tsx` — amount, paid, cancel, and restore confirmation flows.
- `desktop/src/features/booking/ui/FamilyDetailsScreen.tsx` — age, enrollments, payment state, and family entry point.
- `desktop/src/features/booking/ui/GroupsScreen.tsx` — group entry point and active student count.
- `desktop/src/features/booking/ui/LessonRoster.tsx` — post-trial conversion entry point.
- `desktop/src/features/booking/ui/LessonParticipantDialog.tsx` — remove the one-option select.
- `desktop/src/features/booking/ui/BookingSettingsScreen.tsx` — center payment day.
- `desktop/src/features/booking/ui/BookingSidebarNav.tsx` — tariff/payment destinations and payment badge.
- `desktop/src/app/routes/booking.tariffs.tsx`, `desktop/src/app/routes/booking.payments.tsx` — lazy route boundaries.
- `desktop/src/app/routes.ts`, `desktop/src/app/routeTree.gen.ts` — route registration/generated tree.

### Tests

- Domain tests stay beside the corresponding domain file as `.test.mjs`.
- UI journeys extend `desktop/tests/e2e/airhop-clients.spec.ts` and add `desktop/tests/e2e/airhop-commerce.spec.ts`.

---

### Task 1: Booking Workspace v8 commerce schema and migration

**Files:**
- Modify: `desktop/src/features/booking/model/bookingCore.ts`
- Modify: `desktop/src/features/booking/model/bookingWorkspaceMigration.ts`
- Modify: `desktop/src/features/booking/model/bookingCore.test.mjs`
- Modify: `desktop/src/features/booking/model/demoSchedule.ts`
- Modify: `desktop/src/features/booking/model/demoSchedule.test.mjs`

**Interfaces:**
- Produces: `BookingTariff`, `WeeklyScheduleSelection`, `ConfiguredBookingEnrollment`, `PaymentExpectation`, `paymentExpectationStatusSchema`.
- Produces: `BookingWorkspace` v8 with `tariffs` and `paymentExpectations` arrays and `organization.paymentDayOfMonth`.
- Consumes: existing `bookingIdSchema`, `weekdaySchema`, `isoDateSchema`, and `moneySchema` conventions.

- [ ] **Step 1: Write failing schema and migration tests**

Add tests that parse a configured enrollment, reject missing tariff/slots, parse a payment snapshot, and migrate a v7 enrollment without inventing money:

Build `v8Workspace` by spreading the existing fully valid workspace fixture from
`bookingCore.test.mjs`, changing `schemaVersion` to `8`, adding
`organization.paymentDayOfMonth: 5`, and adding the concrete tariff, enrollment,
and payment records below. Define `legacyV7WithEnrollment` by copying that same
fixture before the v8 fields are added and appending one valid v7 enrollment.

```js
test("Booking Core v8 validates tariffs, weekly slots and payments", () => {
  const configuredEnrollment = {
    id: "enrollment-robotics",
    organizationId: "org-airhop",
    familyId: "family-petrova",
    childId: "child-masha",
    groupId: "group-robotics",
    startDate: "2026-08-06",
    status: "active",
    source: "staff_ui",
    assignmentState: "configured",
    tariffId: "tariff-twice",
    weeklyScheduleSelections: [
      { recurrenceRuleId: "rule-robotics", weekday: "tuesday" },
    ],
    createdAt: NOW,
    updatedAt: NOW,
  };
  const firstPayment = {
    id: "payment-enrollment-robotics-first",
    organizationId: "org-airhop",
    familyId: "family-petrova",
    childId: "child-masha",
    enrollmentId: "enrollment-robotics",
    tariffId: "tariff-twice",
    tariffNameSnapshot: "2 раза в неделю",
    amountMinor: 600000,
    currency: "RUB",
    dueDate: "2026-08-06",
    status: "expected",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const workspace = {
    ...validV7Workspace,
    schemaVersion: 8,
    organization: { ...validV7Workspace.organization, paymentDayOfMonth: 5 },
    tariffs: [{
      id: "tariff-twice",
      organizationId: "org-airhop",
      name: "2 раза в неделю",
      description: "Два регулярных дня",
      priceMinor: 600000,
      currency: "RUB",
      weeklyScheduleLimit: 2,
      status: "active",
      createdAt: NOW,
      updatedAt: NOW,
    }],
    enrollments: [configuredEnrollment],
    paymentExpectations: [firstPayment],
  };
  assert.equal(parseBookingWorkspace(workspace).schemaVersion, 8);
});

test("v7 enrollment migrates to needs_assignment without a payment", () => {
  const migrated = parseBookingWorkspace(legacyV7WithEnrollment);
  assert.equal(migrated.enrollments[0].assignmentState, "needs_assignment");
  assert.deepEqual(migrated.enrollments[0].weeklyScheduleSelections, []);
  assert.deepEqual(migrated.tariffs, []);
  assert.deepEqual(migrated.paymentExpectations, []);
});
```

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test \
  src/features/booking/model/bookingCore.test.mjs \
  src/features/booking/model/demoSchedule.test.mjs
```

Expected: FAIL because schema v8 fields and exported types do not exist.

- [ ] **Step 3: Implement v8 schemas**

Add these shapes to `bookingCore.ts` and extend operational validation references:

```ts
export const tariffSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  name: z.string().trim().min(1).max(160),
  description: z.string().trim().max(4_000).optional(),
  priceMinor: z.number().int().nonnegative().safe(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  weeklyScheduleLimit: z.number().int().min(1).max(7),
  paymentDayOfMonth: z.number().int().min(1).max(28).optional(),
  status: z.enum(["active", "archived"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const weeklyScheduleSelectionSchema = z.object({
  recurrenceRuleId: bookingIdSchema,
  weekday: weekdaySchema,
});

export const paymentExpectationSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  familyId: bookingIdSchema,
  childId: bookingIdSchema,
  enrollmentId: bookingIdSchema,
  tariffId: bookingIdSchema,
  tariffNameSnapshot: z.string().trim().min(1).max(160),
  amountMinor: z.number().int().nonnegative().safe(),
  currency: z.string().regex(/^[A-Z]{3}$/),
  dueDate: isoDateSchema,
  status: z.enum(["expected", "paid", "cancelled"]),
  paidAt: z.string().datetime({ offset: true }).optional(),
  paidBy: z.string().trim().min(1).max(200).optional(),
  cancelledAt: z.string().datetime({ offset: true }).optional(),
  cancelledBy: z.string().trim().min(1).max(200).optional(),
  internalReason: z.string().trim().min(1).max(4_000).optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
```

Represent legacy and configured enrollment states explicitly. A `configured` record requires `tariffId` and a non-empty selection; `needs_assignment` has an empty selection and no tariff. Change the workspace literal to v8, add `organization.paymentDayOfMonth`, `tariffs`, and `paymentExpectations`.

- [ ] **Step 4: Implement v7→v8 migration and demo defaults**

Append one migration branch:

```ts
if (legacy.schemaVersion === 7) {
  legacy = {
    ...legacy,
    schemaVersion: 8,
    organization: { ...legacy.organization, paymentDayOfMonth: 5 },
    tariffs: [],
    paymentExpectations: [],
    enrollments: Array.isArray(legacy.enrollments)
      ? legacy.enrollments.map((enrollment) => ({
          ...enrollment,
          assignmentState: "needs_assignment",
          weeklyScheduleSelections: [],
        }))
      : [],
  };
}
```

Make demo workspaces native v8 and seed three active tariffs: one, two, and three days per week. Do not seed a PaymentExpectation without a real enrollment.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all tests pass.

- [ ] **Step 6: Commit the schema boundary**

```bash
git add desktop/src/features/booking/model/bookingCore.ts \
  desktop/src/features/booking/model/bookingWorkspaceMigration.ts \
  desktop/src/features/booking/model/bookingCore.test.mjs \
  desktop/src/features/booking/model/demoSchedule.ts \
  desktop/src/features/booking/model/demoSchedule.test.mjs
git commit -m "feat(airhop): add tariff and payment workspace schema"
```

---

### Task 2: Commerce validation and atomic mutations

**Files:**
- Create: `desktop/src/features/booking/model/bookingCommerce.ts`
- Create: `desktop/src/features/booking/model/bookingCommerce.test.mjs`
- Modify: `desktop/src/features/booking/model/bookingMutations.ts`
- Modify: `desktop/src/features/booking/model/bookingMutations.test.mjs`
- Modify: `desktop/src/features/booking/model/bookingOperationalValidation.ts`

**Interfaces:**
- Consumes: v8 types from Task 1.
- Produces: `createTariff`, `updateTariff`, `setTariffStatus`, `createConfiguredEnrollmentWithPayment`, `reconfigureEnrollment`, `setPaymentStatus`, `updateExpectedPaymentAmount`.
- Produces: `BookingCommerceError` with stable codes for UI and Action Service.

- [ ] **Step 1: Write failing mutation tests**

Cover tariff CRUD, group/day ownership, limit enforcement, atomic first payment, immutable payment snapshots, and status transitions:

In `bookingCommerce.test.mjs`, define one `configuredEnrollment` and
`firstPayment` with the same concrete IDs as Task 1. Derive every negative case
from those objects so the assertion changes exactly one invariant.

```js
test("configured enrollment and first payment are created atomically", () => {
  const draft = createConfiguredEnrollmentWithPayment(workspace, {
    enrollment: configuredEnrollment,
    payment: firstPayment,
  });
  assert.equal(draft.enrollments.at(-1).tariffId, "tariff-twice");
  assert.equal(draft.paymentExpectations.at(-1).amountMinor, 600000);
});

test("weekly slot must belong to the group and fit the tariff", () => {
  assert.throws(
    () => createConfiguredEnrollmentWithPayment(workspace, {
      enrollment: {
        ...configuredEnrollment,
        weeklyScheduleSelections: [
          { recurrenceRuleId: "rule-from-another-group", weekday: "tuesday" },
        ],
      },
      payment: firstPayment,
    }),
    ({ code }) => code === "invalid_weekly_selection",
  );
});

test("changing a tariff never rewrites an existing payment snapshot", () => {
  const changed = updateTariff(workspaceWithPayment, changedTariff);
  assert.equal(changed.paymentExpectations[0].amountMinor, 600000);
});
```

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test \
  src/features/booking/model/bookingCommerce.test.mjs \
  src/features/booking/model/bookingMutations.test.mjs
```

Expected: FAIL because commerce functions do not exist.

- [ ] **Step 3: Implement focused commerce helpers**

Use immutable drafts and validate before returning:

```ts
export type BookingCommerceErrorCode =
  | "unknown_tariff"
  | "archived_tariff"
  | "invalid_weekly_selection"
  | "schedule_limit_exceeded"
  | "overlapping_enrollment"
  | "invalid_payment_transition";

export function weeklySelectionKey(selection: WeeklyScheduleSelection): string {
  return `${selection.recurrenceRuleId}:${selection.weekday}`;
}

export function createConfiguredEnrollmentWithPayment(
  workspace: BookingWorkspace,
  input: {
    enrollment: ConfiguredBookingEnrollment;
    payment: PaymentExpectation;
  },
): BookingWorkspaceDraft;
```

Validation must ensure organization/family/child/group/tariff ownership, active group/tariff/rules, weekday membership, uniqueness, age at `startDate`, no overlapping enrollment, and `payment.enrollmentId === enrollment.id`. Parse the resulting draft through the workspace schema before returning it.

- [ ] **Step 4: Add tariff/payment referential validation**

Extend `bookingOperationalValidation.ts` so broken tariff, enrollment, weekly selection, family, child, and payment references fail parsing with precise paths. Block archiving a recurrence rule or removing a weekday when an active configured enrollment uses that slot.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run the command from Step 2. Expected: all commerce and mutation tests pass.

- [ ] **Step 6: Commit commerce mutations**

```bash
git add desktop/src/features/booking/model/bookingCommerce.ts \
  desktop/src/features/booking/model/bookingCommerce.test.mjs \
  desktop/src/features/booking/model/bookingMutations.ts \
  desktop/src/features/booking/model/bookingMutations.test.mjs \
  desktop/src/features/booking/model/bookingOperationalValidation.ts
git commit -m "feat(airhop): validate tariff backed enrollments"
```

---

### Task 3: Lesson coverage, age, and commerce read models

**Files:**
- Modify: `desktop/src/features/booking/model/bookingOperations.ts`
- Modify: `desktop/src/features/booking/model/bookingOperations.test.mjs`
- Create: `desktop/src/features/booking/lib/bookingCommerceReadModels.ts`
- Create: `desktop/src/features/booking/lib/bookingCommerceReadModels.test.mjs`
- Modify: `desktop/src/features/booking/lib/bookingLocale.ts`
- Modify: `desktop/src/features/booking/lib/bookingLocale.test.mjs`
- Modify: `desktop/src/features/booking/lib/bookingClients.ts`
- Modify: `desktop/src/features/booking/lib/bookingClients.test.mjs`

**Interfaces:**
- Consumes: configured/legacy enrollment and payment types.
- Produces: `enrollmentCoversLesson`, `paymentDisplayState`, `familyEnrollmentRows`, `paymentQueueRows`, `groupActiveEnrollmentCount`, `formatChildAgeAndBirthDate`.

- [ ] **Step 1: Write failing coverage and formatter tests**

```js
test("configured enrollment covers only its selected weekday", () => {
  assert.equal(enrollmentCoversLesson(enrollment, tuesdayLesson), true);
  assert.equal(enrollmentCoversLesson(enrollment, thursdayLesson), false);
});

test("legacy needs_assignment enrollment temporarily covers the whole group", () => {
  assert.equal(enrollmentCoversLesson(legacyEnrollment, thursdayLesson), true);
});

test("child age renders full years next to localized birth date", () => {
  assert.equal(
    formatChildAgeAndBirthDate({ birthDate: "2019-03-14", onDate: "2026-08-06", locale: "ru-RU" }),
    "7 лет · 14 марта 2019 г.",
  );
});
```

Add queue tests proving overdue is computed from `status === "expected"` and `dueDate < currentDate`, and that paid/cancelled rows sort after open rows.

- [ ] **Step 2: Run focused tests and verify RED**

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test \
  src/features/booking/model/bookingOperations.test.mjs \
  src/features/booking/lib/bookingCommerceReadModels.test.mjs \
  src/features/booking/lib/bookingLocale.test.mjs \
  src/features/booking/lib/bookingClients.test.mjs
```

Expected: FAIL on missing helpers and existing all-group enrollment behavior.

- [ ] **Step 3: Implement coverage and read models**

```ts
export function enrollmentCoversLesson(
  enrollment: BookingEnrollment,
  lesson: { groupId: string; date: string; lessonRef: StableLessonReference },
): boolean {
  if (!isEnrollmentActiveOn(enrollment, lesson.date)) return false;
  if (enrollment.groupId !== lesson.groupId) return false;
  if (enrollment.assignmentState === "needs_assignment") return true;
  const weekday = weekdayForIsoDate(lesson.date);
  return enrollment.weeklyScheduleSelections.some(
    (slot) =>
      slot.recurrenceRuleId === lesson.lessonRef.recurrenceRuleId &&
      slot.weekday === weekday,
  );
}
```

Update lesson occupancy and roster composition to call this helper. Build commerce read models without storing derived labels in the workspace.

- [ ] **Step 4: Implement localized age display**

Compute completed years using ISO calendar components, not milliseconds. Use organization time-zone current date supplied by callers. Use `Intl.PluralRules` for Russian `год/года/лет` and `Intl.DateTimeFormat` for the birth date.

- [ ] **Step 5: Run focused tests and verify GREEN**

Run Step 2. Expected: all tests pass.

- [ ] **Step 6: Commit read models**

```bash
git add desktop/src/features/booking/model/bookingOperations.ts \
  desktop/src/features/booking/model/bookingOperations.test.mjs \
  desktop/src/features/booking/lib/bookingCommerceReadModels.ts \
  desktop/src/features/booking/lib/bookingCommerceReadModels.test.mjs \
  desktop/src/features/booking/lib/bookingLocale.ts \
  desktop/src/features/booking/lib/bookingLocale.test.mjs \
  desktop/src/features/booking/lib/bookingClients.ts \
  desktop/src/features/booking/lib/bookingClients.test.mjs
git commit -m "feat(airhop): derive enrollment and payment views"
```

---

### Task 4: Staff and Fizz commerce actions

**Files:**
- Modify: `desktop/src/features/booking/actions/airhopActionSchemas.ts`
- Modify: `desktop/src/features/booking/actions/airhopActionService.ts`
- Modify: `desktop/src/features/booking/actions/airhopActionService.test.mjs`

**Interfaces:**
- Consumes: Task 2 mutations.
- Produces commands: `CreateExistingStudent` with tariff/slots, `CreateTariff`, `UpdateTariff`, `SetTariffStatus`, `SetPaymentStatus`, `UpdatePaymentAmount`.
- Preserves: `prepareAirhopAction`, `commitAirhopAction`, `executeAirhopAction` and 24-hour expiry.

- [ ] **Step 1: Write failing action tests**

Add tests for direct staff enrollment, Fizz preview/commit, idempotency, first payment, tariff preview, payment status preview, and failed atomic validation:

```js
test("Fizz enrollment preview includes tariff, slots and first payment", async () => {
  const prepared = await prepareAirhopAction(repository, enrollmentCommand, fizzActor, context);
  assert.match(prepared.preview.lines.join("\n"), /2 раза в неделю/);
  assert.match(prepared.preview.lines.join("\n"), /Вторник/);
  assert.match(prepared.preview.lines.join("\n"), /6 000/);
  assert.equal((await repository.load()).enrollments.length, 0);
});
```

- [ ] **Step 2: Run action tests and verify RED**

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test \
  src/features/booking/actions/airhopActionService.test.mjs
```

Expected: FAIL because new command fields/types are absent.

- [ ] **Step 3: Extend command schemas and planner**

Extend `CreateExistingStudent`:

```ts
z.object({
  type: z.literal("CreateExistingStudent"),
  client: airhopClientSelectorSchema,
  groupId: bookingIdSchema,
  tariffId: bookingIdSchema,
  weeklyScheduleSelections: z.array(weeklyScheduleSelectionSchema).min(1),
  startDate: isoDateSchema,
})
```

Add tariff and payment commands with explicit fields; do not accept arbitrary patches. For `CreateExistingStudent`, resolve the client, construct deterministic enrollment/payment IDs from `context.idFactory`, snapshot the tariff, and call `createConfiguredEnrollmentWithPayment` once.

- [ ] **Step 4: Add localized commerce previews**

Preview lines must include child, group, tariff, localized slots, enrollment start, first payment amount/date, or the exact payment/tariff change. Staff direct execution uses the same planner without creating PendingAction. Fizz preparation persists only PendingAction until commit.

- [ ] **Step 5: Run action tests and verify GREEN**

Run Step 2. Expected: all action tests pass.

- [ ] **Step 6: Commit action contract**

```bash
git add desktop/src/features/booking/actions/airhopActionSchemas.ts \
  desktop/src/features/booking/actions/airhopActionService.ts \
  desktop/src/features/booking/actions/airhopActionService.test.mjs
git commit -m "feat(airhop): add tariff and enrollment actions"
```

---

### Task 5: Tariff catalog UI and routing

**Files:**
- Create: `desktop/src/features/booking/ui/TariffFormDialog.tsx`
- Create: `desktop/src/features/booking/ui/TariffsScreen.tsx`
- Create: `desktop/src/app/routes/booking.tariffs.tsx`
- Modify: `desktop/src/app/routes.ts`
- Modify generated: `desktop/src/app/routeTree.gen.ts`
- Modify: `desktop/src/features/booking/ui/BookingSidebarNav.tsx`
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`
- Modify: `desktop/src/features/booking/lib/bookingAdmin.test.mjs`

**Interfaces:**
- Consumes: tariff mutations/actions and existing money input helpers.
- Produces: route `/booking/tariffs`, `data-testid="airhop-tariffs"`, tariff form test IDs.

- [ ] **Step 1: Add failing locale/navigation tests**

Assert new keys exist in Russian fallback and sidebar metadata exposes «Тарифы» at `/booking/tariffs`.

- [ ] **Step 2: Run locale/admin tests and verify RED**

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test \
  src/features/booking/lib/bookingAdmin.test.mjs \
  src/features/booking/lib/bookingLocale.test.mjs
```

Expected: FAIL for missing tariff copy/navigation.

- [ ] **Step 3: Implement tariff form**

Fields: name, optional description, price, currency, weekly limit, inherited/custom payment day. Reuse `parseMajorMoneyInput`, `BookingSelect`, `Dialog`, and unsaved-change behavior. Validate currency and price before invoking `createTariff`/`updateTariff`.

- [ ] **Step 4: Implement catalog screen**

Render active tariffs first, archive behind a filter, show localized money, weekly limit, and payment day. Archive/restore uses confirmation and blocks save feedback through `BookingFeedbackBanners`. Keep buttons at least 44 CSS pixels on mobile.

- [ ] **Step 5: Register route and sidebar**

Create the lazy route, add `/tariffs` to `routes.ts`, add a `ReceiptText` navigation item, then run `pnpm run build` once to regenerate `routeTree.gen.ts`.

- [ ] **Step 6: Run focused tests and build**

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test \
  src/features/booking/lib/bookingAdmin.test.mjs \
  src/features/booking/lib/bookingLocale.test.mjs
pnpm run build
```

Expected: tests and production build pass.

- [ ] **Step 7: Commit tariff UI**

```bash
git add desktop/src/features/booking/ui/TariffFormDialog.tsx \
  desktop/src/features/booking/ui/TariffsScreen.tsx \
  desktop/src/app/routes/booking.tariffs.tsx \
  desktop/src/app/routes.ts desktop/src/app/routeTree.gen.ts \
  desktop/src/features/booking/ui/BookingSidebarNav.tsx \
  desktop/src/features/booking/lib/bookingAdminLocale.ts \
  desktop/src/features/booking/lib/bookingAdmin.test.mjs
git commit -m "feat(airhop): add tariff catalog"
```

---

### Task 6: Center payment-day setting

**Files:**
- Modify: `desktop/src/features/booking/ui/BookingSettingsScreen.tsx`
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`
- Modify: `desktop/src/features/booking/ui/BookingSettingsScreen` coverage in `desktop/tests/e2e/airhop-commerce.spec.ts`

**Interfaces:**
- Consumes: `organization.paymentDayOfMonth` from Task 1.
- Produces: `data-testid="airhop-settings-payment-day"` and saved day 1–28.

- [ ] **Step 1: Add the failing E2E assertion**

Create the commerce E2E file with a settings test that changes the day from 5 to 10, reloads, and sees 10.

- [ ] **Step 2: Run just that E2E and verify RED**

```bash
cd desktop
pnpm exec playwright test tests/e2e/airhop-commerce.spec.ts --project=smoke -g "payment day"
```

Expected: FAIL because the control is absent.

- [ ] **Step 3: Add the settings field**

Add `paymentDay` to `SettingsForm`, validate integer 1–28, persist through `organizationSchema`, and add a short hint that tariff-specific days override it.

- [ ] **Step 4: Run the focused E2E and verify GREEN**

Run Step 2. Expected: PASS.

- [ ] **Step 5: Commit payment-day settings**

```bash
git add desktop/src/features/booking/ui/BookingSettingsScreen.tsx \
  desktop/src/features/booking/lib/bookingAdminLocale.ts \
  desktop/tests/e2e/airhop-commerce.spec.ts
git commit -m "feat(airhop): configure center payment day"
```

---

### Task 7: Shared weekly-slot picker and enrollment dialog

**Files:**
- Create: `desktop/src/features/booking/ui/WeeklySchedulePicker.tsx`
- Create: `desktop/src/features/booking/ui/EnrollmentDialog.tsx`
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`
- Modify: `desktop/tests/e2e/airhop-commerce.spec.ts`

**Interfaces:**
- Consumes: `CreateExistingStudent` action, family search, groups, active tariffs, recurrence rules.
- Produces: `EnrollmentDialog` props `{ open, onOpenChange, initialChildId?, initialGroupId?, sourceVisit? }`.
- Produces: accessible `WeeklySchedulePicker` controlled by `WeeklyScheduleSelection[]` and `maxSelections`.

- [ ] **Step 1: Add failing E2E for a configured enrollment**

Create a tariff through the UI, open enrollment from a known family, choose group and weekly slots, confirm, and assert the first payment summary appears.

- [ ] **Step 2: Run the enrollment E2E and verify RED**

```bash
cd desktop
pnpm exec playwright test tests/e2e/airhop-commerce.spec.ts --project=smoke -g "enrolls a child"
```

Expected: FAIL because no enrollment dialog exists.

- [ ] **Step 3: Implement weekly slot derivation and picker**

Flatten each active group recurrence rule into one choice per weekday:

```ts
type WeeklySlotOption = WeeklyScheduleSelection & {
  label: string;
  startTime: string;
  endTime: string;
};
```

Disable unselected choices after the tariff limit is reached, keep selected choices enabled for removal, and expose the count in text rather than color alone.

- [ ] **Step 4: Implement the shared enrollment dialog**

The dialog supports existing/new client selection when no child is preselected, group selection when no group is preselected, active tariff selection, weekly slots, start date, and a final summary. Execute the staff action only after the summary confirmation. On small screens use one scroll container and a sticky footer inside `DialogContent`.

- [ ] **Step 5: Run the enrollment E2E and focused action tests**

```bash
cd desktop
pnpm exec playwright test tests/e2e/airhop-commerce.spec.ts --project=smoke -g "enrolls a child"
node --import ./test-loader.mjs --experimental-strip-types --test \
  src/features/booking/actions/airhopActionService.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit shared enrollment UI**

```bash
git add desktop/src/features/booking/ui/WeeklySchedulePicker.tsx \
  desktop/src/features/booking/ui/EnrollmentDialog.tsx \
  desktop/src/features/booking/lib/bookingAdminLocale.ts \
  desktop/tests/e2e/airhop-commerce.spec.ts
git commit -m "feat(airhop): add permanent enrollment flow"
```

---

### Task 8: Family card age, enrollments, and payment summary

**Files:**
- Modify: `desktop/src/features/booking/ui/FamilyDetailsScreen.tsx`
- Modify: `desktop/tests/e2e/airhop-clients.spec.ts`
- Modify: `desktop/tests/e2e/airhop-commerce.spec.ts`

**Interfaces:**
- Consumes: `formatChildAgeAndBirthDate`, `familyEnrollmentRows`, and `EnrollmentDialog`.
- Produces: `data-testid="airhop-child-enrollments-<childId>"` and family entry point.

- [ ] **Step 1: Add failing family-card assertions**

Assert that a child born `2022-03-02` shows `4 года · 2 марта 2022 г.` on 2026-08-04, and an enrolled child shows group, tariff, selected slots, and `К оплате`.

- [ ] **Step 2: Run client/commerce E2E and verify RED**

```bash
cd desktop
pnpm exec playwright test \
  tests/e2e/airhop-clients.spec.ts \
  tests/e2e/airhop-commerce.spec.ts \
  --project=smoke -g "age|family enrollment"
```

Expected: FAIL on missing age/enrollment UI.

- [ ] **Step 3: Refactor child cards without changing edit behavior**

Keep child name/date editing on the existing child button, render age/date through the locale helper, and add a separate enrollment section so nested interactive controls are not placed inside a button.

- [ ] **Step 4: Add enrollment summaries and entry point**

For each child show configured enrollments with tariff and slots; show `Требуется назначить тариф` for migrated legacy enrollments. Add «Зачислить в группу» and «Изменить тариф и расписание» actions using the shared dialog.

- [ ] **Step 5: Run E2E and verify GREEN**

Run Step 2. Expected: PASS and no horizontal overflow.

- [ ] **Step 6: Commit family UI**

```bash
git add desktop/src/features/booking/ui/FamilyDetailsScreen.tsx \
  desktop/tests/e2e/airhop-clients.spec.ts \
  desktop/tests/e2e/airhop-commerce.spec.ts
git commit -m "feat(airhop): show child tariffs and age"
```

---

### Task 9: Group and post-trial enrollment entry points

**Files:**
- Modify: `desktop/src/features/booking/ui/GroupsScreen.tsx`
- Modify: `desktop/src/features/booking/ui/LessonRoster.tsx`
- Modify: `desktop/src/features/booking/ui/ScheduleScreen.tsx`
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`
- Modify: `desktop/tests/e2e/airhop-commerce.spec.ts`
- Modify: `desktop/tests/e2e/airhop-lesson-participants.spec.ts`

**Interfaces:**
- Consumes: `EnrollmentDialog`, `groupActiveEnrollmentCount`, lesson roster source/visit kind.
- Produces: group-preselected and child/group-preselected enrollment flows.

- [ ] **Step 1: Add failing E2E for trial conversion**

Create/locate a trial visitor, mark attendance, click «Зачислить в группу», choose tariff/slot, and assert the child appears as permanent only on selected future lessons.

- [ ] **Step 2: Run the trial conversion E2E and verify RED**

```bash
cd desktop
pnpm exec playwright test tests/e2e/airhop-commerce.spec.ts \
  --project=smoke -g "converts a trial"
```

Expected: FAIL because the roster action is absent.

- [ ] **Step 3: Add group entry point**

Show active permanent student count on each group card and «Добавить постоянного ученика» for active groups with active recurrence rules. Open EnrollmentDialog with `initialGroupId`.

- [ ] **Step 4: Add post-trial entry point**

Only rows whose Booking `visitKind === "trial"` and which do not already have an active enrollment show «Зачислить в группу». Pass the child and group to EnrollmentDialog; preserve the trial Booking after success.

- [ ] **Step 5: Run E2E and lesson/roster unit tests**

```bash
cd desktop
pnpm exec playwright test \
  tests/e2e/airhop-commerce.spec.ts \
  tests/e2e/airhop-lesson-participants.spec.ts \
  --project=smoke
node --import ./test-loader.mjs --experimental-strip-types --test \
  src/features/booking/lib/bookingClients.test.mjs \
  src/features/booking/model/bookingOperations.test.mjs
```

Expected: PASS.

- [ ] **Step 6: Commit entry points**

```bash
git add desktop/src/features/booking/ui/GroupsScreen.tsx \
  desktop/src/features/booking/ui/LessonRoster.tsx \
  desktop/src/features/booking/ui/ScheduleScreen.tsx \
  desktop/src/features/booking/lib/bookingAdminLocale.ts \
  desktop/tests/e2e/airhop-commerce.spec.ts \
  desktop/tests/e2e/airhop-lesson-participants.spec.ts
git commit -m "feat(airhop): convert trials to permanent students"
```

---

### Task 10: Payment work queue and actions

**Files:**
- Create: `desktop/src/features/booking/ui/PaymentActionDialog.tsx`
- Create: `desktop/src/features/booking/ui/PaymentsScreen.tsx`
- Create: `desktop/src/app/routes/booking.payments.tsx`
- Modify: `desktop/src/app/routes.ts`
- Modify generated: `desktop/src/app/routeTree.gen.ts`
- Modify: `desktop/src/features/booking/ui/BookingSidebarNav.tsx`
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`
- Modify: `desktop/tests/e2e/airhop-commerce.spec.ts`

**Interfaces:**
- Consumes: `paymentQueueRows` and payment Action Service commands.
- Produces: route `/booking/payments`, open-payment sidebar badge, direct payment controls.

- [ ] **Step 1: Add failing payment queue E2E**

After enrollment, open Payments, assert child/tariff/amount/due date, change the amount, mark paid, filter paid, cancel/restore a separate expected payment, and verify the family card updates.

- [ ] **Step 2: Run payment E2E and verify RED**

```bash
cd desktop
pnpm exec playwright test tests/e2e/airhop-commerce.spec.ts \
  --project=smoke -g "payment queue"
```

Expected: FAIL because route and controls are absent.

- [ ] **Step 3: Implement PaymentActionDialog**

Use explicit modes `amount | paid | cancel | restore`. Cancellation requires non-empty internal reason; restore and paid show a summary; amount uses the payment currency and existing money parser. Execute staff actions only on final confirmation.

- [ ] **Step 4: Implement PaymentsScreen**

Default filter shows overdue first, then expected. Paid/cancelled filters remain available. Each row shows child, family, tariff snapshot, amount, due date, computed state, and links to family. Add route and sidebar badge counting open payments.

- [ ] **Step 5: Run E2E and production build**

```bash
cd desktop
pnpm exec playwright test tests/e2e/airhop-commerce.spec.ts --project=smoke
pnpm run build
```

Expected: PASS; route tree regenerates and TypeScript has no errors.

- [ ] **Step 6: Commit payment UI**

```bash
git add desktop/src/features/booking/ui/PaymentActionDialog.tsx \
  desktop/src/features/booking/ui/PaymentsScreen.tsx \
  desktop/src/app/routes/booking.payments.tsx \
  desktop/src/app/routes.ts desktop/src/app/routeTree.gen.ts \
  desktop/src/features/booking/ui/BookingSidebarNav.tsx \
  desktop/src/features/booking/lib/bookingAdminLocale.ts \
  desktop/tests/e2e/airhop-commerce.spec.ts
git commit -m "feat(airhop): add payment work queue"
```

---

### Task 11: Single available visit-kind cleanup

**Files:**
- Modify: `desktop/src/features/booking/ui/LessonParticipantDialog.tsx`
- Modify: `desktop/tests/e2e/airhop-lesson-participants.spec.ts`

**Interfaces:**
- Consumes: existing `availableVisitKinds`.
- Produces: plain read-only label for one kind, select only for two kinds.

- [ ] **Step 1: Add failing dialog assertion**

For a trial-only lesson, assert text «Пробное» exists and no combobox named «Тип посещения» exists. For a lesson allowing both, assert the combobox has «Пробное» and «Разовое».

- [ ] **Step 2: Run the focused E2E and verify RED**

```bash
cd desktop
pnpm exec playwright test tests/e2e/airhop-lesson-participants.spec.ts \
  --project=smoke -g "visit type"
```

Expected: FAIL because the single-option select is still rendered.

- [ ] **Step 3: Render label or select**

Use a non-interactive bordered value when `visitKinds.length === 1`; retain `BookingSelect` only when length is two. Preserve form submission and the direct-booking behavior.

- [ ] **Step 4: Run focused E2E and verify GREEN**

Run Step 2. Expected: PASS.

- [ ] **Step 5: Commit the cleanup**

```bash
git add desktop/src/features/booking/ui/LessonParticipantDialog.tsx \
  desktop/tests/e2e/airhop-lesson-participants.spec.ts
git commit -m "fix(airhop): simplify single visit type"
```

---

### Task 12: Mobile acceptance and full verification

**Files:**
- Modify as failures require: only files already listed in Tasks 1–11.
- Test: `desktop/tests/e2e/airhop-commerce.spec.ts`
- Test: `desktop/tests/e2e/airhop-clients.spec.ts`
- Test: `desktop/tests/e2e/airhop-lesson-participants.spec.ts`

**Interfaces:**
- Consumes: complete vertical slice.
- Produces: verified, buildable AirHop preview with no horizontal overflow.

- [ ] **Step 1: Add 351×704 acceptance pass**

Run tariff creation, enrollment, family summary, and payment queue at 351×704. At every route and open dialog assert:

```ts
expect(
  await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  ),
).toBeLessThanOrEqual(1);
```

- [ ] **Step 2: Run all booking unit tests**

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test \
  "src/features/booking/**/*.test.mjs"
```

Expected: all pass.

- [ ] **Step 3: Run AirHop E2E**

```bash
cd desktop
pnpm exec playwright test \
  tests/e2e/airhop-commerce.spec.ts \
  tests/e2e/airhop-clients.spec.ts \
  tests/e2e/airhop-lesson-participants.spec.ts \
  --project=smoke
```

Expected: all pass at desktop and mobile viewports defined by the specs.

- [ ] **Step 4: Run static and build checks**

```bash
cd desktop
pnpm exec tsc --noEmit --pretty false
pnpm exec biome check \
  src/features/booking \
  src/app/routes/booking.tariffs.tsx \
  src/app/routes/booking.payments.tsx \
  tests/e2e/airhop-commerce.spec.ts \
  tests/e2e/airhop-clients.spec.ts \
  tests/e2e/airhop-lesson-participants.spec.ts
pnpm check:file-sizes
pnpm run build
```

Expected: zero errors; existing Vite chunk-size warnings may remain.

- [ ] **Step 5: Run the full desktop unit suite**

```bash
cd desktop
pnpm test
```

Expected: all tests pass.

- [ ] **Step 6: Inspect final diff and commit acceptance fixes**

```bash
git diff --check
git status --short
git add desktop/tests/e2e/airhop-commerce.spec.ts \
  desktop/tests/e2e/airhop-clients.spec.ts \
  desktop/tests/e2e/airhop-lesson-participants.spec.ts
git commit -m "test(airhop): cover tariff enrollment journey"
```

Do not stage unrelated dirty files. If no acceptance-only files changed after the preceding commits, skip the final commit rather than creating an empty commit.
