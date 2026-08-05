# AirHop Staff Entry and Fizz Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add permanent enrollments, staff-created requests, lesson-level trial/single participants, attendance, and a preview/commit command layer that both the Buzz AirHop UI and Fizz tools use.

**Architecture:** Upgrade Booking Workspace to schema v7 and keep all state changes behind a pure AirHop Action Service. Manual UI calls `execute`; Fizz-facing tools call `prepare` and `commit` against the same planner. Read models combine enrollments, bookings, intake requests, and attendance without duplicating children. The browser preview continues to persist through the existing revisioned Booking Repository; the Fizz tool adapter is transport-neutral so a later client-VPS HTTP/MCP bridge can call the same contract without changing business rules.

**Tech Stack:** TypeScript 6, React 19, Zod 4, TanStack Router, Radix UI, Tailwind CSS, Node test runner, Playwright, existing Buzz AirHop repository/provider.

## Global Constraints

- Preserve existing Buzz components, tokens, responsive behavior, and localization architecture.
- Keep external public-widget `purpose: "trial" | "lesson"` unchanged. Store the internal attendance intent separately as `visitKind: "trial" | "single"`; map public `lesson` to internal `single`.
- Every staff/Fizz-created Booking starts as `pending_confirmation` and therefore appears under «Новые».
- A Booking reserves capacity; an `IntakeRequest` without an occurrence does not.
- `single` visits default to disabled and resolve by occurrence override → group override → organization default.
- Agent changes must not write before `commit`; manual UI must call the same planner through `execute`.
- Never create partial family/child/enrollment/request records: each command returns one complete workspace draft or throws without mutation.
- Do not add a parallel production backend in this slice. Define and test the Fizz tool contract in the desktop app; implement the client-VPS transport once the server persistence boundary is chosen.
- Use test-driven development for each task and commit only the files named by that task.

---

### Task 1: Upgrade Booking Workspace to v7

**Files:**
- Modify: `desktop/src/features/booking/model/bookingCore.ts`
- Modify: `desktop/src/features/booking/model/bookingWorkspaceMigration.ts`
- Modify: `desktop/src/features/booking/model/bookingCore.test.mjs`
- Modify: `desktop/src/features/booking/model/demoSchedule.ts`

- [ ] **Step 1: Add failing schema and migration tests**

Add fixtures asserting that v6 data migrates to v7 with:

```ts
{
  schemaVersion: 7,
  enrollments: [],
  intakeRequests: [],
  pendingActions: [],
  attendanceRecords: [],
  organization: {
    ...legacy.organization,
    allowSingleVisitsByDefault: false,
    existingStudentsOnboarding: { status: "not_started" },
  },
}
```

Also assert that existing public bookings receive `visitKind: "trial"` when `source.purpose === "trial"` and `visitKind: "single"` when `source.purpose === "lesson"`.

- [ ] **Step 2: Run the focused test and confirm it fails**

Run:

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/booking/model/bookingCore.test.mjs
```

Expected: failure because schema v7 fields are not implemented.

- [ ] **Step 3: Add the v7 domain schemas**

In `bookingCore.ts`, add and export:

```ts
export const bookingVisitKindSchema = z.enum(["trial", "single"]);
export const enrollmentSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  familyId: bookingIdSchema,
  childId: bookingIdSchema,
  groupId: bookingIdSchema,
  startDate: isoDateSchema,
  endDate: isoDateSchema.optional(),
  status: z.enum(["active", "paused", "ended"]),
  source: z.enum(["staff_ui", "fizz", "import"]),
  createdBy: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const intakeRequestSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  familyId: bookingIdSchema,
  representativeId: bookingIdSchema,
  childId: bookingIdSchema,
  branchId: bookingIdSchema.optional(),
  groupId: bookingIdSchema.optional(),
  sourceChannel: z.enum(["phone", "visit", "telegram", "max", "whatsapp", "other"]),
  internalComment: z.string().trim().max(4_000).optional(),
  status: z.enum(["new", "converted", "closed"]),
  bookingId: bookingIdSchema.optional(),
  createdBy: z.string().trim().min(1).max(200),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

export const attendanceRecordSchema = z.object({
  id: bookingIdSchema,
  organizationId: bookingIdSchema,
  childId: bookingIdSchema,
  lessonRef: stableLessonReferenceSchema,
  status: z.enum(["present", "absent"]),
  markedBy: z.string().trim().min(1).max(200),
  markedAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
```

Add a discriminated `pendingActionSchema` with serialized normalized command, expected revision, checksum, actor/thread metadata, localized preview lines, 24-hour expiry, status, and optional commit result IDs. Add `visitKind`, `createdBy`, `source.channel`, and `internalComment` to Booking with migration defaults. Add `allowSingleVisitsByDefault`, onboarding status, group override, and occurrence override fields.

- [ ] **Step 4: Validate all new references**

Extend `validateBookingWorkspaceReferences` to reject unknown family/child/group/branch/booking/occurrence links, duplicate attendance per child+occurrence, duplicate pending action IDs, invalid enrollment ranges, and overlapping active enrollment ranges for the same child/group.

- [ ] **Step 5: Implement v6 → v7 migration and update demo data**

Migration must be pure, preserve all v6 records, initialize empty arrays, and map existing booking intent as defined above. Update `demoSchedule.ts` to emit schema v7 explicitly.

- [ ] **Step 6: Run tests and typecheck**

Run:

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/booking/model/bookingCore.test.mjs src/features/booking/model/demoSchedule.test.mjs
pnpm typecheck
```

Expected: all pass.

- [ ] **Step 7: Commit**

```bash
git add desktop/src/features/booking/model/bookingCore.ts desktop/src/features/booking/model/bookingWorkspaceMigration.ts desktop/src/features/booking/model/bookingCore.test.mjs desktop/src/features/booking/model/demoSchedule.ts
git commit -m "feat(airhop): add staff operations domain model"
```

### Task 2: Implement visit policy, enrollment, and attendance primitives

**Files:**
- Create: `desktop/src/features/booking/model/bookingOperations.ts`
- Create: `desktop/src/features/booking/model/bookingOperations.test.mjs`
- Modify: `desktop/src/features/booking/model/bookingMutations.ts`
- Modify: `desktop/src/features/booking/model/bookingMutations.test.mjs`
- Modify: `desktop/src/features/booking/model/materializeSchedule.ts`
- Modify: `desktop/src/features/booking/model/demoSchedule.ts`

- [ ] **Step 1: Write failing policy and mutation tests**

Cover:

- default `single` permission is false;
- group and occurrence override precedence;
- active enrollment on the lesson date;
- no enrollment before `startDate`, after `endDate`, or with paused/ended status;
- duplicate overlapping active enrollment rejection;
- attendance set, replace, and clear;
- no mutation of Booking or Enrollment when attendance changes.

- [ ] **Step 2: Run focused tests and confirm failure**

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/booking/model/bookingOperations.test.mjs src/features/booking/model/bookingMutations.test.mjs
```

- [ ] **Step 3: Implement pure resolvers**

In `bookingOperations.ts`, add:

```ts
export function resolveSingleVisitAllowed(
  workspace: BookingWorkspace,
  lessonRef: StableLessonReference,
): boolean;

export function isEnrollmentActiveOn(
  enrollment: BookingEnrollment,
  date: string,
): boolean;

export function attendanceForLesson(
  workspace: BookingWorkspace,
  lessonRef: StableLessonReference,
): ReadonlyMap<string, BookingAttendanceRecord>;
```

Derive the group through the stable occurrence rather than accepting an unverified group ID.

- [ ] **Step 4: Implement atomic primitive mutations**

Add `createEnrollment`, `upsertAttendanceRecord`, and `clearAttendanceRecord` to `bookingMutations.ts`. All return a complete `BookingWorkspaceDraft`; none mutate input arrays.

- [ ] **Step 5: Expose effective policy on materialized lessons**

Add `singleVisitAllowed` and effective `trackAttendance` to the materialized occurrence model so UI does not repeat inheritance logic.

- [ ] **Step 6: Run focused tests**

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/booking/model/bookingOperations.test.mjs src/features/booking/model/bookingMutations.test.mjs src/features/booking/model/demoSchedule.test.mjs
```

- [ ] **Step 7: Commit**

```bash
git add desktop/src/features/booking/model/bookingOperations.ts desktop/src/features/booking/model/bookingOperations.test.mjs desktop/src/features/booking/model/bookingMutations.ts desktop/src/features/booking/model/bookingMutations.test.mjs desktop/src/features/booking/model/materializeSchedule.ts desktop/src/features/booking/model/demoSchedule.ts
git commit -m "feat(airhop): add enrollment and attendance primitives"
```

### Task 3: Build the shared AirHop Action Service

**Files:**
- Create: `desktop/src/features/booking/actions/airhopActionSchemas.ts`
- Create: `desktop/src/features/booking/actions/airhopActionService.ts`
- Create: `desktop/src/features/booking/actions/airhopActionService.test.mjs`
- Modify: `desktop/src/features/booking/model/bookingClientIdentity.ts`
- Modify: `desktop/src/features/booking/model/publicBooking.ts`

- [ ] **Step 1: Write failing command parity tests**

For `CreateExistingStudent`, `CreateBookingRequest`, `CreateUnassignedRequest`, `AddLessonParticipant`, and `MarkAttendance`, assert:

- `execute(command)` and `prepare(command)` + `commit(id)` produce equivalent domain records;
- prepare alone leaves workspace business collections unchanged except for `pendingActions`;
- expired preview cannot commit;
- repeat commit is idempotent;
- stale revision or changed capacity returns a typed conflict;
- a command cannot create partial client records;
- ambiguous identity match returns `identity_choice_required`.

- [ ] **Step 2: Define strict command and result schemas**

Use English protocol keys and discriminated unions. Keep raw actor metadata separate from command payload. Define:

```ts
type AirhopActor = {
  userId: string;
  surface: "staff_ui" | "fizz";
  agentId?: string;
  channelId?: string;
  threadId?: string;
};

type AirhopActionContext = {
  now: string;
  idempotencyKey: string;
};
```

`AddLessonParticipant` must include `lessonRef`, `visitKind`, client selector or new-client payload, source channel, and optional internal comment.

- [ ] **Step 3: Implement one pure planner**

Implement `planAirhopAction(workspace, command, actor, context)`. It validates identity, active entities, occurrence, age, capacity, trial policy, single-visit permission, and duplicate participant rules. It returns normalized command, localized preview data, checksum inputs, result IDs, and a workspace draft.

- [ ] **Step 4: Implement execute/prepare/commit**

`execute` applies the planner result immediately. `prepare` persists only `PendingAction` with `expiresAt = now + 24h`. `commit` reparses the stored command, checks the checksum/revision-sensitive invariants, and applies the same planner. A second commit returns the stored result IDs.

- [ ] **Step 5: Reuse existing public booking creation**

Extract shared booking construction/idempotency helpers from `publicBooking.ts` without changing public booking behavior. Do not duplicate phone normalization, stable occurrence resolution, or capacity counting.

- [ ] **Step 6: Run focused tests**

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/booking/actions/airhopActionService.test.mjs src/features/booking/model/bookingClientIdentity.test.mjs src/features/booking/model/publicBooking.test.mjs
pnpm typecheck
```

- [ ] **Step 7: Commit**

```bash
git add desktop/src/features/booking/actions/airhopActionSchemas.ts desktop/src/features/booking/actions/airhopActionService.ts desktop/src/features/booking/actions/airhopActionService.test.mjs desktop/src/features/booking/model/bookingClientIdentity.ts desktop/src/features/booking/model/publicBooking.ts
git commit -m "feat(airhop): add shared action service"
```

### Task 4: Unify request and lesson roster read models

**Files:**
- Modify: `desktop/src/features/booking/lib/bookingClients.ts`
- Modify: `desktop/src/features/booking/lib/bookingClients.test.mjs`
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`
- Modify: `desktop/src/features/booking/lib/bookingLocale.test.mjs`

- [ ] **Step 1: Add failing read-model tests**

Assert that:

- request queue merges Booking and IntakeRequest, sorted with new/attention first;
- IntakeRequest displays «Нужно подобрать занятие» and never affects capacity;
- lesson roster includes active enrollments plus pending/confirmed bookings;
- the same child from enrollment and booking appears once with permanent status;
- roster entry exposes `visitKind`, request status, attendance status/author/time, family, representative, and child;
- source labels and all new statuses are localized through `ru-RU` messages.

- [ ] **Step 2: Introduce discriminated request rows**

Replace the Booking-only row with:

```ts
type BookingQueueRow = { kind: "booking"; booking: PublicLessonBooking; /* resolved fields */ };
type IntakeQueueRow = { kind: "intake"; request: BookingIntakeRequest; /* resolved fields */ };
type BookingRequestRow = BookingQueueRow | IntakeQueueRow;
```

Provide type guards so UI branches remain exhaustive.

- [ ] **Step 3: Introduce a source-aware roster row**

Use `source: "enrollment" | "booking" | "enrollment_and_booking"`, optional booking/enrollment, and stable child/family fields. Deduplicate by child ID after validating organization/family links.

- [ ] **Step 4: Run tests**

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/booking/lib/bookingClients.test.mjs src/features/booking/lib/bookingLocale.test.mjs
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src/features/booking/lib/bookingClients.ts desktop/src/features/booking/lib/bookingClients.test.mjs desktop/src/features/booking/lib/bookingAdminLocale.ts desktop/src/features/booking/lib/bookingLocale.test.mjs
git commit -m "feat(airhop): unify requests and lesson roster"
```

### Task 5: Add one-off visit settings at center, group, and lesson levels

**Files:**
- Modify: `desktop/src/features/booking/ui/BookingSettingsScreen.tsx`
- Modify: `desktop/src/features/booking/ui/GroupFormDialog.tsx`
- Modify: `desktop/src/features/booking/ui/LessonEditDialog.tsx`
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`
- Modify: `desktop/tests/e2e/airhop-schedule.spec.ts`

- [ ] **Step 1: Add failing E2E assertions**

Verify center default is off, group can inherit/allow/deny, lesson can inherit/allow/deny, and reopening each form shows the saved value.

- [ ] **Step 2: Run the focused E2E and confirm failure**

```bash
cd desktop
pnpm build:e2e
pnpm exec playwright test tests/e2e/airhop-schedule.spec.ts --project=smoke --reporter=line
```

- [ ] **Step 3: Add localized controls**

Use the existing switch/select patterns. Center copy: «Разовые посещения» and «Разрешить запись на одно обычное занятие». Group/lesson options: «Как в центре/группе», «Разрешить», «Запретить». Do not introduce a price field in this slice.

- [ ] **Step 4: Persist through existing mutations**

Extend existing settings/group/lesson saves rather than writing directly to repository storage.

- [ ] **Step 5: Run E2E and typecheck**

```bash
cd desktop
pnpm typecheck
pnpm build:e2e
pnpm exec playwright test tests/e2e/airhop-schedule.spec.ts --project=smoke --reporter=line
```

- [ ] **Step 6: Commit**

```bash
git add desktop/src/features/booking/ui/BookingSettingsScreen.tsx desktop/src/features/booking/ui/GroupFormDialog.tsx desktop/src/features/booking/ui/LessonEditDialog.tsx desktop/src/features/booking/lib/bookingAdminLocale.ts desktop/tests/e2e/airhop-schedule.spec.ts
git commit -m "feat(airhop): configure one-off visits"
```

### Task 6: Add manual request creation

**Files:**
- Create: `desktop/src/features/booking/ui/BookingRequestCreateDialog.tsx`
- Create: `desktop/src/features/booking/ui/BookingClientPicker.tsx`
- Modify: `desktop/src/features/booking/ui/BookingRequestsScreen.tsx`
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`
- Create: `desktop/tests/e2e/airhop-staff-requests.spec.ts`

- [ ] **Step 1: Write failing mobile-first E2E scenarios**

Cover:

1. select existing family and child, choose an occurrence, source phone, create pending Booking;
2. create a new family/representative/child and an unassigned IntakeRequest;
3. both appear under «Новые» after reload;
4. selected occurrence shows actual remaining capacity;
5. no horizontal overflow at 365×704 and 1280×800.

- [ ] **Step 2: Add the primary action and empty-state guidance**

Place «Добавить заявку» in the page header. Empty state also says «Или попросите Физа создать её из сообщения или звонка».

- [ ] **Step 3: Build shared client picker**

Search existing families by child, representative, or phone. Allow choosing a child or switching to a new-client form using the existing family form conventions. Keep the dialog scrollable with a sticky footer on small viewports.

- [ ] **Step 4: Build request blocks**

Use blocks for Client, Child, Request, Source, Comment. Occurrence selection uses materialized active lessons; unassigned mode allows optional branch/group interest. Submit once through `AirhopActionService.execute` inside `booking.save`.

- [ ] **Step 5: Render both request kinds**

Update cards and filters exhaustively for Booking and IntakeRequest. Confirmation/rejection applies only to Booking until intake conversion is implemented.

- [ ] **Step 6: Run verification**

```bash
cd desktop
pnpm typecheck
pnpm build:e2e
pnpm exec playwright test tests/e2e/airhop-staff-requests.spec.ts --project=smoke --reporter=line
```

- [ ] **Step 7: Commit**

```bash
git add desktop/src/features/booking/ui/BookingRequestCreateDialog.tsx desktop/src/features/booking/ui/BookingClientPicker.tsx desktop/src/features/booking/ui/BookingRequestsScreen.tsx desktop/src/features/booking/lib/bookingAdminLocale.ts desktop/tests/e2e/airhop-staff-requests.spec.ts
git commit -m "feat(airhop): add manual request creation"
```

### Task 7: Add participants and attendance from the lesson dialog

**Files:**
- Create: `desktop/src/features/booking/ui/LessonParticipantDialog.tsx`
- Modify: `desktop/src/features/booking/ui/LessonRoster.tsx`
- Modify: `desktop/src/features/booking/ui/ScheduleScreen.tsx`
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`
- Create: `desktop/tests/e2e/airhop-lesson-participants.spec.ts`

- [ ] **Step 1: Write failing E2E scenarios**

Cover:

- existing child added as trial;
- new client added from the same dialog;
- when both modes are allowed, employee chooses «Пробное» or «Разовое»;
- when only one mode is allowed, the selector is omitted;
- when neither mode is allowed, action is disabled with a settings explanation;
- saved participant appears immediately as «Новая» and reserves capacity;
- present, absent, and clear attendance states persist after reload;
- controls are hidden when attendance tracking is disabled;
- dialog scrolls and has no horizontal overflow at 351×704.

- [ ] **Step 2: Make LessonRoster stateful through callbacks**

Pass `onAddParticipant`, `onSetAttendance`, `isSaving`, and effective policy from `ScheduleScreen`. Do not let `LessonRoster` access repository directly.

- [ ] **Step 3: Build LessonParticipantDialog**

Reuse `BookingClientPicker`. Fix lesson context at the top. Derive available modes from effective trial policy and `singleVisitAllowed`. Show trial price only for paid trials. Submit `AddLessonParticipant` through `execute`.

- [ ] **Step 4: Add attendance controls**

Each roster row shows separate badges for participant source/request status and attendance. «Пришёл» and «Не пришёл» are mutually exclusive toggle buttons; clicking the active value clears it. Save through `MarkAttendance` command.

- [ ] **Step 5: Run verification**

```bash
cd desktop
pnpm typecheck
pnpm build:e2e
pnpm exec playwright test tests/e2e/airhop-lesson-participants.spec.ts --project=smoke --reporter=line
pnpm exec playwright test tests/e2e/airhop-schedule.spec.ts --project=smoke --reporter=line
```

- [ ] **Step 6: Commit**

```bash
git add desktop/src/features/booking/ui/LessonParticipantDialog.tsx desktop/src/features/booking/ui/LessonRoster.tsx desktop/src/features/booking/ui/ScheduleScreen.tsx desktop/src/features/booking/lib/bookingAdminLocale.ts desktop/tests/e2e/airhop-lesson-participants.spec.ts
git commit -m "feat(airhop): manage lesson participants and attendance"
```

### Task 8: Add existing-student enrollment UI and onboarding entry point

**Files:**
- Create: `desktop/src/features/booking/ui/ExistingStudentDialog.tsx`
- Modify: `desktop/src/features/booking/ui/ClientsScreen.tsx`
- Modify: `desktop/src/features/booking/ui/FamilyDetailsScreen.tsx`
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`
- Modify: `desktop/tests/e2e/airhop-clients.spec.ts`

- [ ] **Step 1: Add failing E2E tests**

Verify new and existing families can be enrolled, the group and start date are required, future lessons show the child, and a duplicate overlapping enrollment gets a clear message.

- [ ] **Step 2: Add «Зачислить действующего ученика»**

Place the action in Clients and family details. For family details, preselect the family. Use the shared client picker otherwise. Submit `CreateExistingStudent` through `execute`, never through sequential entity saves.

- [ ] **Step 3: Show enrollment information**

Family details lists active group, branch, start date, and status. Clients empty/onboarding state links to the same dialog.

- [ ] **Step 4: Run verification**

```bash
cd desktop
pnpm typecheck
pnpm build:e2e
pnpm exec playwright test tests/e2e/airhop-clients.spec.ts --project=smoke --reporter=line
pnpm exec playwright test tests/e2e/airhop-lesson-participants.spec.ts --project=smoke --reporter=line
```

- [ ] **Step 5: Commit**

```bash
git add desktop/src/features/booking/ui/ExistingStudentDialog.tsx desktop/src/features/booking/ui/ClientsScreen.tsx desktop/src/features/booking/ui/FamilyDetailsScreen.tsx desktop/src/features/booking/lib/bookingAdminLocale.ts desktop/tests/e2e/airhop-clients.spec.ts
git commit -m "feat(airhop): onboard existing students"
```

### Task 9: Define and test the Fizz tool adapter

**Files:**
- Create: `desktop/src/features/booking/agents/airhopFizzTools.ts`
- Create: `desktop/src/features/booking/agents/airhopFizzTools.test.mjs`
- Create: `desktop/src/features/booking/agents/airhopFizzOnboarding.ts`
- Create: `desktop/src/features/booking/agents/airhopFizzOnboarding.test.mjs`
- Modify: `desktop/src/features/booking/ui/ClientsScreen.tsx`
- Modify: `desktop/src/features/booking/lib/bookingAdminLocale.ts`

- [ ] **Step 1: Write failing contract tests**

Test JSON-schema inputs and outputs for:

- `airhop_find_clients`;
- `airhop_list_groups`;
- `airhop_list_lessons`;
- `airhop_prepare_existing_student`;
- `airhop_prepare_request`;
- `airhop_prepare_lesson_participant`;
- `airhop_prepare_attendance`;
- `airhop_get_action`;
- `airhop_cancel_action`;
- `airhop_commit_action`.

Assert all mutating tools call `prepare` or `commit`, never repository mutation helpers, and all reads remain organization-scoped.

- [ ] **Step 2: Implement a transport-neutral tool registry**

Define `AirhopFizzToolEnvironment` with `loadWorkspace`, `saveWorkspace`, actor metadata, clock, and ID generator. The browser implementation wraps the Booking Repository revision contract; a later MCP/HTTP process can implement the same interface.

- [ ] **Step 3: Implement onboarding state transitions**

Pure functions decide when to offer onboarding: at least one active branch and group, state `not_started`, no active enrollment. Implement `begin`, `postpone`, and `complete` transitions. Do not automatically send repeated messages after postpone.

- [ ] **Step 4: Surface the onboarding handoff**

Clients screen shows «Попросить Физа помочь» and a concise prompt that can be copied/sent to the Fizz thread. Do not fabricate a direct agent message injection until the Buzz thread/tool bridge exists.

- [ ] **Step 5: Run contract tests**

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test src/features/booking/agents/airhopFizzTools.test.mjs src/features/booking/agents/airhopFizzOnboarding.test.mjs
pnpm typecheck
```

- [ ] **Step 6: Commit**

```bash
git add desktop/src/features/booking/agents/airhopFizzTools.ts desktop/src/features/booking/agents/airhopFizzTools.test.mjs desktop/src/features/booking/agents/airhopFizzOnboarding.ts desktop/src/features/booking/agents/airhopFizzOnboarding.test.mjs desktop/src/features/booking/ui/ClientsScreen.tsx desktop/src/features/booking/lib/bookingAdminLocale.ts
git commit -m "feat(airhop): define Fizz booking tools"
```

### Task 10: Full regression, responsive QA, and documentation

**Files:**
- Modify: `docs/superpowers/specs/2026-08-05-airhop-staff-entry-and-fizz-onboarding-design.md`
- Create: `docs/airhop/fizz-action-tools.md`
- Modify: files from prior tasks only for verified defects

- [ ] **Step 1: Run all booking unit tests**

```bash
cd desktop
node --import ./test-loader.mjs --experimental-strip-types --test "src/features/booking/**/*.test.mjs"
```

Expected: all booking tests pass.

- [ ] **Step 2: Run AirHop E2E tests**

```bash
cd desktop
pnpm build:e2e
pnpm exec playwright test tests/e2e/airhop-clients.spec.ts tests/e2e/airhop-public-booking.spec.ts tests/e2e/airhop-schedule.spec.ts tests/e2e/airhop-staff-requests.spec.ts tests/e2e/airhop-lesson-participants.spec.ts --project=smoke --reporter=line
```

- [ ] **Step 3: Run repository quality gates**

```bash
cd desktop
pnpm typecheck
pnpm exec biome check src/features/booking tests/e2e/airhop-clients.spec.ts tests/e2e/airhop-public-booking.spec.ts tests/e2e/airhop-schedule.spec.ts tests/e2e/airhop-staff-requests.spec.ts tests/e2e/airhop-lesson-participants.spec.ts
pnpm check:file-sizes
pnpm check:px-text
pnpm check:pubkey-truncation
```

- [ ] **Step 4: Perform visual QA in the in-app browser**

Check Requests, Clients, and lesson dialog at 351×704, 385×704, 768×1024, 1280×800, and 1440×900. Verify scrolling, sticky actions, focus visibility, no clipped selectors, no horizontal page overflow, and consistent Buzz AirHop dark/light tokens.

- [ ] **Step 5: Document the agent boundary**

Document command schemas, preview lifecycle, 24-hour expiry, idempotency, actor metadata, and the future client-VPS transport boundary. Update the design status to implemented only after every gate passes.

- [ ] **Step 6: Final commit**

```bash
git add docs/superpowers/specs/2026-08-05-airhop-staff-entry-and-fizz-onboarding-design.md docs/airhop/fizz-action-tools.md
git commit -m "docs(airhop): document staff and Fizz workflows"
```

