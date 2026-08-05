# AirHop Families and Booking Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real client directory of families, representatives, and children; a separate booking-request queue; and the expected child roster for every scheduled lesson.

**Architecture:** Extend the versioned `BookingWorkspace` contract from v5 to v6 while retaining immutable applicant snapshots on bookings. A pure identity resolver creates or reuses client entities inside the same repository revision transaction as the booking, and focused selectors feed the requests, clients, and lesson-roster screens. The browser demo continues to use the repository boundary, so the same domain rules remain usable by the later server adapter.

**Tech Stack:** TypeScript, React 19, Zod, TanStack Router, existing Buzz UI primitives, Vitest-compatible Node tests, Playwright E2E, Biome.

## Global Constraints

- Russian is the only shipped MVP locale, but all new UI copy goes through `bookingAdminLocale.ts`.
- A family may have multiple representatives and children; one representative is the primary contact.
- `Booking.applicant` remains an immutable historical snapshot even when the linked client card changes.
- Ambiguous matches create a duplicate candidate and never merge client entities automatically.
- `pending_confirmation` and `confirmed` bookings occupy capacity and appear in the expected roster.
- Public routes never expose client search or family data without a valid management token.
- Existing v5 browser-preview data migrates deterministically and idempotently to v6.
- Public-widget navigation remains unchanged in this slice; a future move into common Buzz AirHop settings is recorded but not implemented.
- Do not add payment, attendance, enrollment, messenger delivery, or Buzz reaction behavior in this slice.

---

## File Structure

### Domain and persistence

- Modify `desktop/src/features/booking/model/bookingCore.ts` — v6 schemas, types, reference validation, and v5 migration entry point.
- Create `desktop/src/features/booking/model/bookingClientIdentity.ts` — normalized identity matching and creation of family records.
- Create `desktop/src/features/booking/model/bookingClientIdentity.test.mjs` — resolver behavior and ambiguous duplicate coverage.
- Modify `desktop/src/features/booking/model/bookingCore.test.mjs` — v6 validation and v5 migration coverage.
- Modify `desktop/src/features/booking/model/bookingMutations.ts` — client CRUD/archive and staff booking transitions.
- Modify `desktop/src/features/booking/model/bookingMutations.test.mjs` — mutation coverage.
- Modify `desktop/src/features/booking/data/publicBookingService.ts` — atomically attach a booking to client records.
- Modify `desktop/src/features/booking/data/publicBookingService.test.mjs` — end-to-end service identity coverage.
- Modify `desktop/src/features/booking/data/demoBookingRepository.ts` — v6 storage key and adoption of the v5 key.
- Modify `desktop/src/features/booking/data/demoBookingRepository.test.mjs` — preview migration key coverage.
- Modify `desktop/src/features/booking/model/demoSchedule.ts` — v6 demo records and representative bookings.

### Queries and presentation

- Create `desktop/src/features/booking/lib/bookingClients.ts` — queue rows, family summaries, search, and lesson roster selectors.
- Create `desktop/src/features/booking/lib/bookingClients.test.mjs` — deterministic selector behavior.
- Modify `desktop/src/features/booking/lib/bookingAdminLocale.ts` — request/client/roster copy.
- Create `desktop/src/features/booking/ui/BookingRequestsScreen.tsx` — actionable request queue.
- Create `desktop/src/features/booking/ui/ClientsScreen.tsx` — searchable family list.
- Create `desktop/src/features/booking/ui/FamilyDetailsScreen.tsx` — family card and related bookings.
- Create `desktop/src/features/booking/ui/FamilyCreateDialog.tsx` — initial family, primary representative, and child form.
- Create `desktop/src/features/booking/ui/RepresentativeFormDialog.tsx` — add/edit representative form.
- Create `desktop/src/features/booking/ui/ChildFormDialog.tsx` — add/edit child form.
- Create `desktop/src/features/booking/ui/LessonRoster.tsx` — expected children on a stable occurrence.
- Modify `desktop/src/features/booking/ui/ScheduleScreen.tsx` — render the roster inside lesson details.
- Modify `desktop/src/features/booking/ui/BookingSidebarNav.tsx` — add Requests and Clients navigation.
- Modify `desktop/src/app/routes.ts` — register staff routes.
- Create `desktop/src/app/routes/booking.requests.tsx`.
- Create `desktop/src/app/routes/booking.clients.tsx`.
- Create `desktop/src/app/routes/booking.clients.$familyId.tsx`.

### Regression and documentation

- Create `desktop/tests/e2e/airhop-clients.spec.ts` — public booking to request queue, client card, and roster journey.
- Modify `desktop/tests/e2e/airhop-public-booking.spec.ts` — preserve existing public flow under v6.
- Modify `docs/AIRHOP_SOURCE_OF_TRUTH.md` — add client entities and replace the old automatic-appearance wording with “Как в Buzz AirHop”.
- Modify `docs/AIRHOP_PUBLIC_BOOKING_DEMO.md` — v6 storage key and client-flow verification steps.

---

### Task 1: Booking Workspace v6 and Deterministic Migration

**Files:**
- Modify: `desktop/src/features/booking/model/bookingCore.ts`
- Test: `desktop/src/features/booking/model/bookingCore.test.mjs`
- Modify: `desktop/src/features/booking/data/demoBookingRepository.ts`
- Test: `desktop/src/features/booking/data/demoBookingRepository.test.mjs`
- Modify: `desktop/src/features/booking/model/demoSchedule.ts`

**Interfaces:**
- Produces: `BookingFamily`, `BookingRepresentative`, `BookingChild`, `BookingDuplicateCandidate`.
- Produces: `BookingWorkspace` with `schemaVersion: 6`, `families`, `representatives`, `children`, and `duplicateCandidates`.
- Produces: `PublicLessonBooking.familyId`, `.representativeId`, and `.childId`.
- Consumes: the existing v5 `applicant` snapshot fields during migration.

- [ ] **Step 1: Write failing schema and migration tests**

Add literal v6 fixtures and one literal v5 booking fixture. Assert that `parseBookingWorkspace(v5)` creates exactly one family, one representative, one child, and preserves the original applicant snapshot.

```js
const migrated = parseBookingWorkspace(v5WorkspaceWithOneBooking);
assert.equal(migrated.schemaVersion, 6);
assert.equal(migrated.families.length, 1);
assert.equal(migrated.representatives[0].phoneNormalized, "+79990001122");
assert.equal(migrated.children[0].birthDate, "2020-04-12");
assert.equal(migrated.bookings[0].familyId, migrated.families[0].id);
assert.equal(migrated.bookings[0].applicant.childName, "Ирина");
```

Add reference-validation assertions for an unknown `familyId`, a child from another family, and a primary representative from another family.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
cd desktop
node --test src/features/booking/model/bookingCore.test.mjs src/features/booking/data/demoBookingRepository.test.mjs
```

Expected: FAIL because schema v6 collections and booking client references do not exist.

- [ ] **Step 3: Add the v6 schemas and exported types**

Use these contracts in `bookingCore.ts`:

```ts
export const familySchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  displayName: z.string().trim().min(1).max(200),
  primaryRepresentativeId: bookingIdSchema,
  status: z.enum(["active", "archived"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const representativeSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  familyId: bookingIdSchema,
  displayName: z.string().trim().min(1).max(160),
  phoneNormalized: z.string().regex(/^\+[1-9]\d{9,14}$/),
  phoneDisplay: z.string().trim().min(1).max(80),
  preferredContactChannel: preferredContactChannelSchema,
  messengerAccounts: z.array(z.object({
    channel: z.enum(["telegram", "max", "whatsapp"]),
    externalUserId: z.string().trim().min(1).max(200),
    displayHandle: z.string().trim().min(1).max(200).optional(),
  })),
  consentVersion: z.string().trim().min(1).max(80),
  consentAcceptedAt: z.string().datetime({ offset: true }),
  status: z.enum(["active", "archived"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const childSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  familyId: bookingIdSchema,
  displayName: z.string().trim().min(1).max(160),
  birthDate: isoDateSchema,
  note: z.string().trim().max(4_000).optional(),
  status: z.enum(["active", "archived"]),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
```

Define duplicate candidates as pairs of entity references and match signals:

```ts
export const duplicateCandidateSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  newEntityType: z.enum(["representative", "child"]),
  newEntityId: bookingIdSchema,
  existingEntityType: z.enum(["representative", "child"]),
  existingEntityId: bookingIdSchema,
  signals: z.array(z.enum(["phone", "messenger", "name_and_birth_date"])).min(1),
  status: z.enum(["pending", "merged", "dismissed"]),
  createdAt: z.string().datetime({ offset: true }),
  resolvedAt: z.string().datetime({ offset: true }).optional(),
  resolvedBy: z.string().trim().min(1).max(200).optional(),
});
```

- [ ] **Step 4: Implement v5→v6 migration and reference validation**

Group v5 bookings by `applicant.phoneNormalized`, then by normalized child name plus `childBirthDate`. Generate stable IDs from collection order (`legacy-family-1`, `legacy-representative-1`, `legacy-child-1`) so parsing the same v5 document twice yields identical JSON.

Extend `validateBookingWorkspaceReferences()` to validate collection IDs, organization ownership, family membership, the primary representative, booking links, and duplicate-candidate entity references.

- [ ] **Step 5: Move preview storage to v6 without losing v5 data**

Set:

```ts
export const DEMO_BOOKING_STORAGE_KEY = "buzz-airhop.booking.workspace.v6";
```

Add `buzz-airhop.booking.workspace.v5` first in `LEGACY_BOOKING_STORAGE_KEYS`. Update `DEMO_BOOKING_WORKSPACE` with empty v6 collections and literal client fixtures used by the new screens.

- [ ] **Step 6: Run focused tests and verify GREEN**

Run the same `node --test` command. Expected: all tests pass with no warnings.

- [ ] **Step 7: Commit the domain upgrade**

```bash
git add desktop/src/features/booking/model/bookingCore.ts desktop/src/features/booking/model/bookingCore.test.mjs desktop/src/features/booking/data/demoBookingRepository.ts desktop/src/features/booking/data/demoBookingRepository.test.mjs desktop/src/features/booking/model/demoSchedule.ts
git commit -s -m "feat(airhop): add family client model"
```

---

### Task 2: Pure Client Identity Resolver and Atomic Public Booking

**Files:**
- Create: `desktop/src/features/booking/model/bookingClientIdentity.ts`
- Create: `desktop/src/features/booking/model/bookingClientIdentity.test.mjs`
- Modify: `desktop/src/features/booking/data/publicBookingService.ts`
- Test: `desktop/src/features/booking/data/publicBookingService.test.mjs`

**Interfaces:**
- Consumes: `BookingWorkspace`, `BookingApplicantSnapshot`, and an injected `{ now, idFactory }`.
- Produces:

```ts
export type ClientIdentityResolution = {
  familyId: string;
  representativeId: string;
  childId: string;
  families: BookingFamily[];
  representatives: BookingRepresentative[];
  children: BookingChild[];
  duplicateCandidates: BookingDuplicateCandidate[];
};

export function resolveBookingApplicantIdentity(
  workspace: BookingWorkspace,
  applicant: BookingApplicantSnapshot,
  options: { now: string; idFactory: () => string },
): ClientIdentityResolution;
```

- [ ] **Step 1: Write resolver tests before implementation**

Cover these independent cases with literal expected IDs:

```js
assert.deepEqual(resolve(firstBooking), {
  familyId: "family-1",
  representativeId: "representative-2",
  childId: "child-3",
  // collections contain exactly the new records
});
```

- first booking creates all three entities;
- same normalized phone and same normalized name/date reuses all entities;
- same representative with a second child creates only the child;
- two active representatives with the same phone create isolated records and a pending duplicate candidate;
- archived representatives are not silently reused;
- repeated resolution against the returned workspace is stable.

- [ ] **Step 2: Run resolver tests and verify RED**

```bash
cd desktop
node --test src/features/booking/model/bookingClientIdentity.test.mjs
```

Expected: FAIL because `resolveBookingApplicantIdentity` is missing.

- [ ] **Step 3: Implement normalization and resolution**

Use one locale-aware normalization helper:

```ts
export function normalizeClientName(value: string, locale: string): string {
  return value.trim().replace(/\s+/g, " ").toLocaleLowerCase(locale);
}
```

Never mutate the input workspace arrays. Return unchanged arrays when reusing an identity and new arrays when creating records.

- [ ] **Step 4: Add service tests proving one repository revision contains client records and booking links**

Extend `publicBookingService.test.mjs` to assert:

```js
const saved = await repository.load();
assert.equal(saved.bookings[0].childId, saved.children[0].id);
assert.equal(saved.bookings[0].representativeId, saved.representatives[0].id);
assert.equal(saved.bookings[0].applicant.phoneDisplay, "+7 999 000-11-22");
```

Also replay the same idempotency key and assert collection lengths remain unchanged.

- [ ] **Step 5: Run service tests and verify RED**

```bash
cd desktop
node --test src/features/booking/data/publicBookingService.test.mjs
```

Expected: FAIL because created bookings do not yet contain client IDs.

- [ ] **Step 6: Integrate the resolver inside `createBooking()`**

Build the final `BookingApplicantSnapshot`, call the resolver, add its four collections and the linked booking to the same `repository.save()` draft, and retain existing revision retries and last-seat checks.

- [ ] **Step 7: Run identity and service tests and verify GREEN**

```bash
cd desktop
node --test src/features/booking/model/bookingClientIdentity.test.mjs src/features/booking/data/publicBookingService.test.mjs
```

- [ ] **Step 8: Commit identity creation**

```bash
git add desktop/src/features/booking/model/bookingClientIdentity.ts desktop/src/features/booking/model/bookingClientIdentity.test.mjs desktop/src/features/booking/data/publicBookingService.ts desktop/src/features/booking/data/publicBookingService.test.mjs
git commit -s -m "feat(airhop): link public bookings to families"
```

---

### Task 3: Client and Staff Booking Mutations

**Files:**
- Modify: `desktop/src/features/booking/model/bookingMutations.ts`
- Test: `desktop/src/features/booking/model/bookingMutations.test.mjs`

**Interfaces:**
- Produces:

```ts
export function upsertBookingFamily(workspace: BookingWorkspace, family: BookingFamily): BookingWorkspaceDraft;
export function upsertBookingRepresentative(workspace: BookingWorkspace, representative: BookingRepresentative): BookingWorkspaceDraft;
export function upsertBookingChild(workspace: BookingWorkspace, child: BookingChild): BookingWorkspaceDraft;
export function setBookingFamilyStatus(workspace: BookingWorkspace, familyId: string, status: BookingFamily["status"], updatedAt: string): BookingWorkspaceDraft;
export function setStaffBookingStatus(workspace: BookingWorkspace, bookingId: string, status: "confirmed" | "rejected", updatedAt: string): BookingWorkspaceDraft;
```

- [ ] **Step 1: Write failing mutation tests**

Test organization ownership, family ownership, unique primary representative, archive propagation only to the family status, immutable applicant snapshots, valid staff transitions, and rejection clearing a transfer request.

- [ ] **Step 2: Verify RED**

```bash
cd desktop
node --test src/features/booking/model/bookingMutations.test.mjs
```

- [ ] **Step 3: Implement minimal validated mutations**

Parse each entity with its Zod schema, reject unknown or cross-family references with `BookingEntityMutationError`, and return `BookingWorkspaceDraft` through the existing `workspaceDraft()` helper.

- [ ] **Step 4: Verify GREEN**

Run the focused mutation test and then:

```bash
cd desktop
node --test src/features/booking/model/bookingCore.test.mjs src/features/booking/model/bookingMutations.test.mjs
```

- [ ] **Step 5: Commit mutations**

```bash
git add desktop/src/features/booking/model/bookingMutations.ts desktop/src/features/booking/model/bookingMutations.test.mjs
git commit -s -m "feat(airhop): add client management mutations"
```

---

### Task 4: Client, Queue, and Lesson-Roster Selectors

**Files:**
- Create: `desktop/src/features/booking/lib/bookingClients.ts`
- Create: `desktop/src/features/booking/lib/bookingClients.test.mjs`
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`

**Interfaces:**
- Produces:

```ts
export type BookingRequestRow = {
  booking: PublicLessonBooking;
  family: BookingFamily;
  representative: BookingRepresentative;
  child: BookingChild;
  groupName: string;
  branchName: string;
  date: string;
  startTime: string;
  requiresAttention: boolean;
};

export function bookingRequestRows(workspace: BookingWorkspace): BookingRequestRow[];
export function searchFamilySummaries(workspace: BookingWorkspace, query: string): FamilySummary[];
export function lessonRoster(workspace: BookingWorkspace, lessonRef: StableLessonReference): LessonRosterEntry[];
export function familyBookings(workspace: BookingWorkspace, familyId: string): BookingRequestRow[];
```

- [ ] **Step 1: Write selector tests with hand-ordered fixtures**

Assert pending requests first, transfer requests second, attention flags third, then newest recently processed. Assert accent/case-insensitive family search by representative, child, and digits-only phone. Assert roster excludes rejected/cancelled records but keeps pending and confirmed records.

- [ ] **Step 2: Verify RED**

```bash
cd desktop
node --test src/features/booking/lib/bookingClients.test.mjs
```

- [ ] **Step 3: Implement selectors as pure functions**

Use maps by ID and `stableLessonReferenceKey()`. Skip invalid rows defensively instead of showing mismatched personal data. Keep sorting deterministic with `createdAt` and `id` tie-breakers.

- [ ] **Step 4: Add all required Russian strings**

Add navigation labels, empty states, filters, statuses, family fields, duplicate warnings, roster headings, archive confirmations, and accessible action labels to `BookingAdminMessages` and `ru` in the same change.

- [ ] **Step 5: Verify GREEN and locale type completeness**

```bash
cd desktop
node --test src/features/booking/lib/bookingClients.test.mjs
pnpm exec tsc --noEmit
```

- [ ] **Step 6: Commit selectors and copy**

```bash
git add desktop/src/features/booking/lib/bookingClients.ts desktop/src/features/booking/lib/bookingClients.test.mjs desktop/src/features/booking/lib/bookingAdminLocale.ts
git commit -s -m "feat(airhop): add client and request selectors"
```

---

### Task 5: Separate Requests Queue

**Files:**
- Create: `desktop/src/features/booking/ui/BookingRequestsScreen.tsx`
- Create: `desktop/src/app/routes/booking.requests.tsx`
- Modify: `desktop/src/app/routes.ts`
- Modify: `desktop/src/features/booking/ui/BookingSidebarNav.tsx`
- Test: `desktop/tests/e2e/airhop-clients.spec.ts`

**Interfaces:**
- Consumes: `bookingRequestRows()` and `setStaffBookingStatus()`.
- Produces: `/booking/requests` and sidebar test ID `open-airhop-requests`.

- [ ] **Step 1: Add a failing Playwright queue test**

Seed one pending booking through the public service path, navigate to `/booking/requests`, and assert the child, representative, lesson, branch, and pending status are visible. Click Confirm, verify the preview dialog, confirm it, and assert the row becomes confirmed and leaves the default pending filter.

- [ ] **Step 2: Build E2E assets and verify RED**

```bash
cd desktop
pnpm run build:e2e
pnpm exec playwright test tests/e2e/airhop-clients.spec.ts --project=smoke --grep "request queue"
```

Expected: FAIL because the route and navigation item are absent.

- [ ] **Step 3: Register the route and sidebar item**

Add `/booking/requests` to the route union and use the `Inbox` icon. Show a badge equal to the number of `pending_confirmation` bookings plus pending transfer requests; hide zero.

- [ ] **Step 4: Implement `BookingRequestsScreen`**

Use `BookingWorkspaceGate`, `BookingFeedbackBanners`, `PageHeader`, accessible filters, and mobile-first cards. Confirmation and rejection each open an `AlertDialog` summarizing exactly one child and lesson before `booking.save()` runs.

- [ ] **Step 5: Verify GREEN at phone and desktop widths**

Run the focused test at the existing smoke project, with assertions at 390×844 and 1366×768 that `document.scrollWidth === document.clientWidth`.

- [ ] **Step 6: Commit the request queue**

```bash
git add desktop/src/features/booking/ui/BookingRequestsScreen.tsx desktop/src/app/routes/booking.requests.tsx desktop/src/app/routes.ts desktop/src/features/booking/ui/BookingSidebarNav.tsx desktop/tests/e2e/airhop-clients.spec.ts
git commit -s -m "feat(airhop): add booking request queue"
```

---

### Task 6: Clients Directory and Family Card

**Files:**
- Create: `desktop/src/features/booking/ui/ClientsScreen.tsx`
- Create: `desktop/src/features/booking/ui/FamilyDetailsScreen.tsx`
- Create: `desktop/src/features/booking/ui/FamilyCreateDialog.tsx`
- Create: `desktop/src/features/booking/ui/RepresentativeFormDialog.tsx`
- Create: `desktop/src/features/booking/ui/ChildFormDialog.tsx`
- Create: `desktop/src/app/routes/booking.clients.tsx`
- Create: `desktop/src/app/routes/booking.clients.$familyId.tsx`
- Modify: `desktop/src/app/routes.ts`
- Modify: `desktop/src/features/booking/ui/BookingSidebarNav.tsx`
- Test: `desktop/tests/e2e/airhop-clients.spec.ts`

**Interfaces:**
- Consumes: family search selectors and Task 3 mutations.
- Produces: `/booking/clients`, `/booking/clients/$familyId`, and `open-airhop-clients`.

- [ ] **Step 1: Add failing E2E tests for search and family editing**

Assert search by child name, representative name, and phone digits. Open a family, add a second child, edit the representative name, reload, and verify both persisted. Archive the family and verify the history remains visible while the active filter excludes it.

- [ ] **Step 2: Verify RED**

```bash
cd desktop
pnpm run build:e2e
pnpm exec playwright test tests/e2e/airhop-clients.spec.ts --project=smoke --grep "clients directory"
```

- [ ] **Step 3: Implement route shells and sidebar navigation**

Use lazy route modules following `booking.groups.tsx`. The family detail route must render a neutral not-found state for an unknown or cross-organization ID.

- [ ] **Step 4: Implement the family list**

Render a single search input, Active/Archived filter, family cards with primary representative and children, and an Add family action. Do not render messenger identifiers in the list.

- [ ] **Step 5: Implement focused forms**

`FamilyCreateDialog` creates a family, primary representative, and first child in one `booking.save()` call. `RepresentativeFormDialog` and `ChildFormDialog` edit one entity each. Validate phone with `normalizePublicBookingPhone()` and dates with `isoDateSchema`; preserve dialog input when saving fails.

- [ ] **Step 6: Implement family details**

Show contacts, children, current/past requests, duplicate warning, internal notes, and archive/restore action. Link every related booking to `/booking/requests` using a `bookingId` search parameter, and provide a schedule link with the occurrence date.

- [ ] **Step 7: Verify GREEN and responsive behavior**

Run the focused E2E tests at 390×844 and 1366×768, then run `pnpm exec tsc --noEmit`.

- [ ] **Step 8: Commit client UI**

```bash
git add desktop/src/features/booking/ui/ClientsScreen.tsx desktop/src/features/booking/ui/FamilyDetailsScreen.tsx desktop/src/features/booking/ui/FamilyCreateDialog.tsx desktop/src/features/booking/ui/RepresentativeFormDialog.tsx desktop/src/features/booking/ui/ChildFormDialog.tsx desktop/src/app/routes/booking.clients.tsx 'desktop/src/app/routes/booking.clients.$familyId.tsx' desktop/src/app/routes.ts desktop/src/features/booking/ui/BookingSidebarNav.tsx desktop/tests/e2e/airhop-clients.spec.ts
git commit -s -m "feat(airhop): add family client directory"
```

---

### Task 7: Expected Children in Lesson Details

**Files:**
- Create: `desktop/src/features/booking/ui/LessonRoster.tsx`
- Modify: `desktop/src/features/booking/ui/ScheduleScreen.tsx`
- Test: `desktop/tests/e2e/airhop-clients.spec.ts`

**Interfaces:**
- Consumes: `lessonRoster(workspace, lessonRef)`.
- Produces: roster rows with links to family and request screens.

- [ ] **Step 1: Add a failing roster E2E test**

Create one pending and one confirmed booking for the same stable occurrence plus one rejected booking. Open the lesson details and assert only the pending and confirmed children appear, with distinct localized status badges and family links.

- [ ] **Step 2: Verify RED**

```bash
cd desktop
pnpm run build:e2e
pnpm exec playwright test tests/e2e/airhop-clients.spec.ts --project=smoke --grep "lesson roster"
```

- [ ] **Step 3: Implement `LessonRoster` and integrate it**

Add a bordered section below the lesson metadata. Empty active roster copy must say that no children are expected yet. Keep cancelled and rejected bookings out of the section; do not add attendance controls.

- [ ] **Step 4: Verify GREEN and no dialog overflow**

Run the roster test at 320×700, 390×844, and 1366×768. Assert the dialog scroll container can reach the roster and the page has no horizontal overflow.

- [ ] **Step 5: Commit the roster**

```bash
git add desktop/src/features/booking/ui/LessonRoster.tsx desktop/src/features/booking/ui/ScheduleScreen.tsx desktop/tests/e2e/airhop-clients.spec.ts
git commit -s -m "feat(airhop): show expected children on lessons"
```

---

### Task 8: Full Regression, Documentation, and Browser Review

**Files:**
- Modify: `desktop/tests/e2e/airhop-public-booking.spec.ts`
- Modify: `docs/AIRHOP_SOURCE_OF_TRUTH.md`
- Modify: `docs/AIRHOP_PUBLIC_BOOKING_DEMO.md`

**Interfaces:**
- Consumes: the completed v6 client slice.
- Produces: a documented and fully verified demo workflow.

- [ ] **Step 1: Add public-flow assertions for v6 without exposing family data**

After a successful booking, assert the public management page contains only the existing management-card fields. In staff context, assert the same booking has valid family, representative, and child links.

- [ ] **Step 2: Update documentation precisely**

Add `Family`, `Representative`, `Child`, and `DuplicateCandidate` sections to the source of truth; add Requests, Clients, and lesson roster to current-slice criteria; set the preview storage key to v6; replace “Как на странице” with “Как в Buzz AirHop”.

- [ ] **Step 3: Run all focused booking tests**

```bash
cd desktop
node --test src/features/booking/model/bookingCore.test.mjs src/features/booking/model/bookingClientIdentity.test.mjs src/features/booking/model/bookingMutations.test.mjs src/features/booking/lib/bookingClients.test.mjs src/features/booking/data/publicBookingService.test.mjs src/features/booking/data/demoBookingRepository.test.mjs
```

Expected: zero failures.

- [ ] **Step 4: Run static and production build gates**

```bash
cd desktop
pnpm check
pnpm run build
```

Expected: exit code 0 for both commands; pre-existing Biome informational messages are reported separately and do not count as failures.

- [ ] **Step 5: Run all AirHop E2E suites**

```bash
cd desktop
pnpm run build:e2e
pnpm exec playwright test tests/e2e/airhop-schedule.spec.ts tests/e2e/airhop-public-booking.spec.ts tests/e2e/airhop-clients.spec.ts --project=smoke
```

Expected: zero failed, skipped, or flaky AirHop tests.

- [ ] **Step 6: Review the live browser at representative widths**

Inspect Requests, Clients, one family, and one lesson roster at 320×700, 390×844, 768×1024, 1366×768, and 1920×1080. Verify touch targets are at least 44px on mobile, dialogs scroll, names wrap without overlay, and no personal data appears on public routes outside the management card.

- [ ] **Step 7: Commit regression and docs**

```bash
git add desktop/tests/e2e/airhop-public-booking.spec.ts docs/AIRHOP_SOURCE_OF_TRUTH.md docs/AIRHOP_PUBLIC_BOOKING_DEMO.md
git commit -s -m "docs(airhop): document family client workflow"
```

---

## Completion Checklist

- [ ] A public booking creates or reuses one family, representative, and child atomically.
- [ ] Replaying an idempotency key creates no duplicate client records.
- [ ] Ambiguous identity matches produce a visible candidate and never auto-merge.
- [ ] Requests is a separate actionable queue with previewed confirm/reject transitions.
- [ ] Clients supports search, manual creation, editing, archive, restore, and persistent history.
- [ ] Lesson details list the expected pending and confirmed children.
- [ ] Existing v5 preview data migrates to v6 without losing applicant snapshots.
- [ ] Public pages expose no client-directory search or unrelated family data.
- [ ] Unit, type, static, build, E2E, and responsive browser checks pass.

