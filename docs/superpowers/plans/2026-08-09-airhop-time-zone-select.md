# AirHop Time Zone Select Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace free-form time-zone entry with a complete IANA select and safely seed new local profiles from the browser time zone.

**Architecture:** A focused booking time-zone utility owns detection, fallback, and option construction. The settings screen renders the existing native `BookingSelect`; the demo repository uses the same detector only when constructing an unsaved initial workspace, so persisted workspaces are never rewritten.

**Tech Stack:** React 19, TypeScript 6, native `Intl`, Node test runner, Playwright.

## Global Constraints

- Persist only concrete valid IANA strings; never persist the automatic-action sentinel.
- Existing saved workspaces keep their current `organization.timeZone`.
- Detection falls back to exactly `Europe/Moscow`.
- Do not add dependencies, schema fields, migrations, search UI, or localized city names.
- Keep the native `BookingSelect` appearance and arrow.

---

### Task 1: Time-zone utilities and new-profile initialization

**Files:**
- Create: `desktop/src/features/booking/lib/bookingTimeZones.ts`
- Create: `desktop/src/features/booking/lib/bookingTimeZones.test.mjs`
- Modify: `desktop/src/features/booking/data/demoBookingRepository.ts`
- Modify: `desktop/src/features/booking/data/demoBookingRepository.test.mjs`

**Interfaces:**
- Produces: `AUTO_BOOKING_TIME_ZONE_VALUE: "__auto__"`.
- Produces: `detectBookingTimeZone(resolve?: () => unknown): string`.
- Produces: `bookingTimeZoneOptions(current: string, supported?: Iterable<string>): string[]`.
- Produces: `createInitialDemoBookingWorkspace(timeZone?: string): BookingWorkspace`.

- [ ] **Step 1: Write failing utility tests**

```js
assert.equal(detectBookingTimeZone(() => "Asia/Tokyo"), "Asia/Tokyo");
assert.equal(detectBookingTimeZone(() => "Mars/Olympus"), "Europe/Moscow");
assert.deepEqual(
  bookingTimeZoneOptions("Europe/Moscow", ["Asia/Tokyo", "Europe/Moscow", "Asia/Tokyo"]),
  ["Asia/Tokyo", "Europe/Moscow"],
);
```

- [ ] **Step 2: Run utility tests and verify RED**

Run: `cd desktop && pnpm test -- src/features/booking/lib/bookingTimeZones.test.mjs`

Expected: FAIL because `bookingTimeZones.ts` does not exist.

- [ ] **Step 3: Implement detection and option construction**

```ts
export const AUTO_BOOKING_TIME_ZONE_VALUE = "__auto__";
export const DEFAULT_BOOKING_TIME_ZONE = "Europe/Moscow";

export function detectBookingTimeZone(
  resolve = () => Intl.DateTimeFormat().resolvedOptions().timeZone,
): string {
  try {
    const value = resolve();
    return typeof value === "string" && isValidTimeZone(value)
      ? value
      : DEFAULT_BOOKING_TIME_ZONE;
  } catch {
    return DEFAULT_BOOKING_TIME_ZONE;
  }
}
```

`bookingTimeZoneOptions` obtains `Intl.supportedValuesOf("timeZone")` when no iterable is injected, filters invalid/sentinel values, includes the current, detected, `UTC`, and fallback zones, removes duplicates, and returns `localeCompare("en")` order.

- [ ] **Step 4: Add failing initial-workspace test**

```js
const initial = createInitialDemoBookingWorkspace("Asia/Tokyo");
assert.equal(initial.organization.timeZone, "Asia/Tokyo");
assert.equal(DEMO_BOOKING_WORKSPACE.organization.timeZone, "Europe/Moscow");
```

- [ ] **Step 5: Run repository test and verify RED**

Run: `cd desktop && pnpm test -- src/features/booking/data/demoBookingRepository.test.mjs`

Expected: FAIL because `createInitialDemoBookingWorkspace` is not exported.

- [ ] **Step 6: Use detected zone only for a new demo workspace**

```ts
export function createInitialDemoBookingWorkspace(
  timeZone = detectBookingTimeZone(),
): BookingWorkspace {
  return {
    ...DEMO_BOOKING_WORKSPACE,
    organization: { ...DEMO_BOOKING_WORKSPACE.organization, timeZone },
  };
}
```

Pass this object as `initialWorkspace` to `BrowserPreviewBookingRepository`; repository storage remains authoritative when it exists.

- [ ] **Step 7: Run both unit tests and verify GREEN**

Run: `cd desktop && pnpm test -- src/features/booking/lib/bookingTimeZones.test.mjs src/features/booking/data/demoBookingRepository.test.mjs`

Expected: both test files pass with zero failures.

- [ ] **Step 8: Commit Task 1**

```bash
git add docs/superpowers/plans/2026-08-09-airhop-time-zone-select.md desktop/src/features/booking/lib/bookingTimeZones.ts desktop/src/features/booking/lib/bookingTimeZones.test.mjs desktop/src/features/booking/data/demoBookingRepository.ts desktop/src/features/booking/data/demoBookingRepository.test.mjs
git commit -s -m "feat(airhop): add booking time zone options"
```

### Task 2: Settings select, localized copy, and browser regression

**Files:**
- Modify: `desktop/src/features/booking/ui/BookingSettingsScreen.tsx`
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`
- Modify: `desktop/src/features/booking/lib/bookingLocale.test.mjs`
- Modify: `desktop/tests/e2e/airhop-schedule.spec.ts`

**Interfaces:**
- Consumes: `AUTO_BOOKING_TIME_ZONE_VALUE`, `detectBookingTimeZone`, and `bookingTimeZoneOptions` from Task 1.
- Produces: settings field `data-testid="airhop-settings-time-zone"` as a native `select`.

- [ ] **Step 1: Write failing copy and E2E tests**

```js
assert.equal(
  getBookingAdminMessages("ru-RU").timeZoneAutomatic("Asia/Tokyo"),
  "Определить автоматически — Asia/Tokyo",
);
```

```ts
const timeZone = page.getByTestId("airhop-settings-time-zone");
await expect(timeZone).toHaveJSProperty("tagName", "SELECT");
await expect(timeZone.locator('option[value="__auto__"]')).toContainText(
  "Определить автоматически",
);
await timeZone.selectOption("Asia/Tokyo");
await page.getByRole("button", { name: "Сохранить" }).click();
await page.reload();
await expect(timeZone).toHaveValue("Asia/Tokyo");
```

- [ ] **Step 2: Run targeted tests and verify RED**

Run: `cd desktop && pnpm test -- src/features/booking/lib/bookingLocale.test.mjs`

Expected: FAIL because `timeZoneAutomatic` does not exist.

Run: `cd desktop && pnpm exec playwright test tests/e2e/airhop-schedule.spec.ts --project=smoke --grep "time zone select"`

Expected: FAIL because the field is still an `input`.

- [ ] **Step 3: Replace the input with `BookingSelect`**

Compute the detected zone and option list with stable React memoization. Render the automatic action first, followed by every IANA option. On automatic selection, assign `detectBookingTimeZone()`; otherwise assign the selected option value.

```tsx
<BookingSelect
  aria-label={messages.timeZone}
  data-testid="airhop-settings-time-zone"
  onChange={(event) => {
    const next =
      event.target.value === AUTO_BOOKING_TIME_ZONE_VALUE
        ? detectedTimeZone
        : event.target.value;
    setForm((current) => ({ ...current, timeZone: next }));
  }}
  value={form.timeZone}
>
  <option value={AUTO_BOOKING_TIME_ZONE_VALUE}>
    {messages.timeZoneAutomatic(detectedTimeZone)}
  </option>
  {timeZoneOptions.map((timeZone) => (
    <option key={timeZone} value={timeZone}>{timeZone}</option>
  ))}
</BookingSelect>
```

- [ ] **Step 4: Update Russian copy**

Add `timeZoneAutomatic(timeZone: string): string` and change the hint to explain that the list contains IANA zones and can detect the device zone.

- [ ] **Step 5: Run unit and E2E tests and verify GREEN**

Run: `cd desktop && pnpm test -- src/features/booking/lib/bookingLocale.test.mjs src/features/booking/lib/bookingTimeZones.test.mjs src/features/booking/data/demoBookingRepository.test.mjs`

Run: `cd desktop && pnpm build:e2e && pnpm exec playwright test tests/e2e/airhop-schedule.spec.ts --project=smoke --grep "time zone select"`

Expected: all targeted tests pass with zero failures.

- [ ] **Step 6: Run static and full unit verification**

Run: `cd desktop && pnpm typecheck`

Run: `cd desktop && pnpm test`

Expected: both commands exit 0.

- [ ] **Step 7: Verify the live page**

Reload `http://127.0.0.1:4173/#/booking/settings`, inspect that the field has a chevron, open the list, choose another zone, save, and reload to confirm persistence.

- [ ] **Step 8: Commit Task 2**

```bash
git add desktop/src/features/booking/ui/BookingSettingsScreen.tsx desktop/src/features/booking/lib/bookingAdminLocale.ts desktop/src/features/booking/lib/bookingLocale.test.mjs desktop/tests/e2e/airhop-schedule.spec.ts
git commit -s -m "feat(airhop): use a time zone selector"
```

