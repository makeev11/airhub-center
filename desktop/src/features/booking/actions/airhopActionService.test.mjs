import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { DEMO_BOOKING_WORKSPACE } from "../model/demoSchedule.ts";
import { parseBookingWorkspace } from "../model/bookingCore.ts";
import {
  AirhopActionError,
  commitAirhopAction,
  executeAirhopAction,
  prepareAirhopAction,
} from "./airhopActionService.ts";
import { airhopActorSchema } from "./airhopActionSchemas.ts";

const NOW = "2026-08-05T09:00:00.000Z";
const LESSON_REF = {
  recurrenceRuleId: "robotics-junior-weekly",
  originalDate: "2026-08-10",
};
const ACTOR = { userId: "owner-one", surface: "staff_ui" };
const FIZZ_AGENT = {
  userId: "owner-one",
  surface: "buzz_agent",
  agentId: "fizz-one",
  specialistRole: "fizz",
  channelId: "welcome",
};
const ADMIN_ACTOR = {
  userId: "owner-one",
  surface: "buzz_agent",
  agentId: "administrator-one",
  specialistRole: "administrator",
  channelId: "welcome",
};
const MONDAY_SELECTION = {
  recurrenceRuleId: "robotics-junior-weekly",
  weekday: "monday",
};

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function context(prefix = "action", now = NOW) {
  let sequence = 0;
  return {
    now,
    idempotencyKey: `${prefix}-idempotency-key`,
    idFactory: () => `${prefix}-${++sequence}`,
    digest,
  };
}

function applicant(overrides = {}) {
  return {
    parentName: "Ирина Соколова",
    phoneNormalized: "+79991234567",
    phoneDisplay: "+7 999 123-45-67",
    childName: "Лев Соколов",
    childBirthDate: "2020-08-10",
    consentVersion: "staff-entry-v1",
    consentAcceptedAt: NOW,
    preferredContactChannel: "telegram",
    ...overrides,
  };
}

function newClient(overrides = {}) {
  return { mode: "new", applicant: applicant(overrides) };
}

function existingStudentCommand(overrides = {}) {
  return {
    type: "CreateExistingStudent",
    client: newClient(),
    groupId: "robotics-junior",
    tariffId: "tariff-weekly-2",
    weeklyScheduleSelections: [MONDAY_SELECTION],
    startDate: "2026-08-05",
    ...overrides,
  };
}

function savedWorkspace(draft, revision) {
  return parseBookingWorkspace({ ...draft, revision });
}

test("buzz_agent actor carries a stable specialist role", () => {
  const actor = airhopActorSchema.parse(ADMIN_ACTOR);

  assert.equal(actor.surface, "buzz_agent");
  assert.equal(actor.agentId, "administrator-one");
  assert.equal(actor.specialistRole, "administrator");
});

test("buzz_agent actor requires identity, role, and channel", () => {
  assert.throws(() =>
    airhopActorSchema.parse({
      userId: "owner-one",
      surface: "buzz_agent",
      agentId: "administrator-one",
      channelId: "welcome",
    }),
  );
});

test("legacy fizz is not a production actor surface", () => {
  assert.throws(() =>
    airhopActorSchema.parse({
      userId: "owner-one",
      surface: "fizz",
      agentId: "fizz-one",
      channelId: "welcome",
    }),
  );
});

test("CreateExistingStudent atomically creates client records and enrollment", () => {
  const result = executeAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    existingStudentCommand(),
    ACTOR,
    context("student"),
  );
  const workspace = savedWorkspace(result.draft, 1);

  assert.equal(workspace.families.length, 1);
  assert.equal(workspace.representatives.length, 1);
  assert.equal(workspace.children.length, 1);
  assert.equal(workspace.enrollments.length, 1);
  assert.equal(workspace.enrollments[0].childId, workspace.children[0].id);
  assert.equal(workspace.enrollments[0].groupId, "robotics-junior");
  assert.equal(workspace.enrollments[0].source, "staff_ui");
  assert.equal(workspace.enrollments[0].tariffId, "tariff-weekly-2");
  assert.deepEqual(workspace.enrollments[0].weeklyScheduleSelections, [
    MONDAY_SELECTION,
  ]);
  assert.equal(workspace.paymentExpectations.length, 1);
  assert.equal(workspace.paymentExpectations[0].amountMinor, 600_000);
  assert.equal(workspace.paymentExpectations[0].dueDate, "2026-08-05");
  assert.deepEqual(result.result.entityIds, [
    workspace.families[0].id,
    workspace.representatives[0].id,
    workspace.children[0].id,
    workspace.enrollments[0].id,
    workspace.paymentExpectations[0].id,
  ]);
});

test("AddLessonParticipant enforces visit policy and creates a confirmed direct booking", () => {
  assert.throws(
    () =>
      executeAirhopAction(
        DEMO_BOOKING_WORKSPACE,
        {
          type: "AddLessonParticipant",
          submissionMode: "direct",
          client: newClient(),
          lessonRef: LESSON_REF,
          visitKind: "single",
          sourceChannel: "phone",
        },
        ACTOR,
        context("single-disabled"),
      ),
    (error) =>
      error instanceof AirhopActionError &&
      error.code === "single_visit_disabled",
  );

  const enabled = structuredClone(DEMO_BOOKING_WORKSPACE);
  enabled.groups.find(
    ({ id }) => id === "robotics-junior",
  ).allowSingleVisitsOverride = true;
  const result = executeAirhopAction(
    enabled,
    {
      type: "AddLessonParticipant",
      submissionMode: "direct",
      client: newClient(),
      lessonRef: LESSON_REF,
      visitKind: "single",
      sourceChannel: "phone",
      internalComment: "Позвонила мама",
    },
    ACTOR,
    context("single-enabled"),
  );
  const workspace = savedWorkspace(result.draft, 1);
  const booking = workspace.bookings[0];

  assert.equal(booking.status, "confirmed");
  assert.equal(booking.visitKind, "single");
  assert.equal(booking.source.surface, "staff_ui");
  assert.equal(booking.source.channel, "phone");
  assert.equal(booking.source.workflow, "direct");
  assert.equal(booking.internalComment, "Позвонила мама");
});

test("AddLessonParticipant does not duplicate an existing participant", () => {
  const enabled = structuredClone(DEMO_BOOKING_WORKSPACE);
  enabled.groups.find(
    ({ id }) => id === "robotics-junior",
  ).allowSingleVisitsOverride = true;
  const trial = executeAirhopAction(
    enabled,
    {
      type: "AddLessonParticipant",
      submissionMode: "direct",
      client: newClient(),
      lessonRef: LESSON_REF,
      visitKind: "trial",
      sourceChannel: "phone",
    },
    ACTOR,
    context("first-visit"),
  );
  const withTrial = savedWorkspace(trial.draft, 1);
  const repeated = executeAirhopAction(
    withTrial,
    {
      type: "AddLessonParticipant",
      submissionMode: "direct",
      client: {
        mode: "existing",
        familyId: withTrial.families[0].id,
        representativeId: withTrial.representatives[0].id,
        childId: withTrial.children[0].id,
      },
      lessonRef: LESSON_REF,
      visitKind: "single",
      sourceChannel: "phone",
    },
    ACTOR,
    context("second-visit"),
  );
  const saved = savedWorkspace(repeated.draft, 2);

  assert.equal(saved.bookings.length, 1);
  assert.deepEqual(repeated.result.entityIds, [saved.bookings[0].id]);
});

test("AddLessonParticipant request mode stays pending and previews a new request", () => {
  const result = executeAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    {
      type: "AddLessonParticipant",
      submissionMode: "request",
      client: newClient(),
      lessonRef: LESSON_REF,
      visitKind: "trial",
      sourceChannel: "phone",
    },
    ACTOR,
    context("request-mode"),
  );
  const workspace = savedWorkspace(result.draft, 1);

  assert.equal(workspace.bookings[0].status, "pending_confirmation");
  assert.equal(workspace.bookings[0].source.workflow, "request");
  assert.ok(result.preview.lines.includes("Статус: Новая заявка"));
});

test("direct lesson entry promotes an existing pending booking without duplicating it", () => {
  const requested = executeAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    {
      type: "CreateBookingRequest",
      client: newClient(),
      lessonRef: LESSON_REF,
      visitKind: "trial",
      sourceChannel: "telegram",
    },
    ACTOR,
    context("pending-before-direct"),
  );
  const withPending = savedWorkspace(requested.draft, 1);
  const pendingId = withPending.bookings[0].id;
  const promoted = executeAirhopAction(
    withPending,
    {
      type: "AddLessonParticipant",
      submissionMode: "direct",
      client: {
        mode: "existing",
        familyId: withPending.families[0].id,
        representativeId: withPending.representatives[0].id,
        childId: withPending.children[0].id,
      },
      lessonRef: LESSON_REF,
      visitKind: "trial",
      sourceChannel: "phone",
    },
    ACTOR,
    context("promote-direct"),
  );
  const workspace = savedWorkspace(promoted.draft, 2);

  assert.equal(workspace.bookings.length, 1);
  assert.equal(workspace.bookings[0].id, pendingId);
  assert.equal(workspace.bookings[0].status, "confirmed");
  assert.equal(workspace.bookings[0].source.channel, "telegram");
  assert.equal(workspace.bookings[0].source.workflow, "direct");
  assert.deepEqual(promoted.result.entityIds, [pendingId]);
});

test("Fizz cannot create a direct confirmed lesson participant", () => {
  assert.throws(
    () =>
      executeAirhopAction(
        DEMO_BOOKING_WORKSPACE,
        {
          type: "AddLessonParticipant",
          submissionMode: "direct",
          client: newClient(),
          lessonRef: LESSON_REF,
          visitKind: "trial",
          sourceChannel: "telegram",
        },
        FIZZ_AGENT,
        context("fizz-direct"),
      ),
    (error) =>
      error instanceof AirhopActionError && error.code === "invalid_actor",
  );
});

test("direct lesson entry preview states that the booking is confirmed", () => {
  const result = executeAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    {
      type: "AddLessonParticipant",
      submissionMode: "direct",
      client: newClient(),
      lessonRef: LESSON_REF,
      visitKind: "trial",
      sourceChannel: "visit",
    },
    ACTOR,
    context("direct-preview"),
  );

  assert.ok(result.preview.lines.includes("Статус: Подтверждено"));
});

test("active enrollments occupy capacity and do not create lesson bookings", () => {
  const limited = structuredClone(DEMO_BOOKING_WORKSPACE);
  limited.groups.find(({ id }) => id === "robotics-junior").capacity = 1;
  const enrolled = executeAirhopAction(
    limited,
    existingStudentCommand(),
    ACTOR,
    context("capacity-student"),
  );
  const withEnrollment = savedWorkspace(enrolled.draft, 1);
  const sameChild = executeAirhopAction(
    withEnrollment,
    {
      type: "AddLessonParticipant",
      submissionMode: "direct",
      client: {
        mode: "existing",
        familyId: withEnrollment.families[0].id,
        representativeId: withEnrollment.representatives[0].id,
        childId: withEnrollment.children[0].id,
      },
      lessonRef: LESSON_REF,
      visitKind: "trial",
      sourceChannel: "phone",
    },
    ACTOR,
    context("enrolled-visit"),
  );
  assert.equal(sameChild.draft.bookings.length, 0);
  assert.deepEqual(sameChild.result.entityIds, [
    withEnrollment.enrollments[0].id,
  ]);

  assert.throws(
    () =>
      executeAirhopAction(
        withEnrollment,
        {
          type: "AddLessonParticipant",
          submissionMode: "direct",
          client: newClient({
            parentName: "Ольга",
            phoneNormalized: "+79997654321",
            phoneDisplay: "+7 999 765-43-21",
            childName: "Маша",
          }),
          lessonRef: LESSON_REF,
          visitKind: "trial",
          sourceChannel: "phone",
        },
        ACTOR,
        context("capacity-overflow"),
      ),
    (error) =>
      error instanceof AirhopActionError && error.code === "capacity_full",
  );
});

test("prepare stores only preview and commit applies it once", () => {
  const command = existingStudentCommand();
  const prepared = prepareAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    command,
    ADMIN_ACTOR,
    context("preview"),
  );
  const withPreview = savedWorkspace(prepared.draft, 1);

  assert.equal(withPreview.families.length, 0);
  assert.equal(withPreview.enrollments.length, 0);
  assert.equal(withPreview.paymentExpectations.length, 0);
  assert.equal(withPreview.pendingActions.length, 1);
  assert.equal(withPreview.pendingActions[0].status, "pending");
  assert.equal(withPreview.pendingActions[0].initiatedBy, "owner-one");
  assert.equal(
    withPreview.pendingActions[0].preparedByAgentId,
    "administrator-one",
  );
  assert.equal(withPreview.pendingActions[0].specialistRole, "administrator");
  assert.equal("requestedBy" in withPreview.pendingActions[0], false);
  assert.equal(
    "requestedThroughAgentId" in withPreview.pendingActions[0],
    false,
  );
  assert.ok(withPreview.pendingActions[0].preview.lines.length >= 3);
  assert.match(prepared.preview.lines.join("\n"), /2 раза в неделю/);
  assert.match(prepared.preview.lines.join("\n"), /Понедельник/i);
  assert.match(prepared.preview.lines.join("\n"), /6.?000/);

  const committed = commitAirhopAction(
    withPreview,
    prepared.action.id,
    "owner-one",
    context("commit"),
  );
  const saved = savedWorkspace(committed.draft, 2);
  assert.equal(saved.families.length, 1);
  assert.equal(saved.enrollments.length, 1);
  assert.equal(saved.paymentExpectations.length, 1);
  assert.equal(saved.pendingActions[0].status, "committed");
  assert.equal(saved.pendingActions[0].confirmedBy, "owner-one");

  const replay = commitAirhopAction(
    saved,
    prepared.action.id,
    "owner-one",
    context("replay"),
  );
  const replayed = savedWorkspace(replay.draft, 3);
  assert.equal(replayed.families.length, 1);
  assert.equal(replayed.enrollments.length, 1);
  assert.deepEqual(replay.result.entityIds, committed.result.entityIds);
});

test("legacy Fizz pending action migrates to specialist attribution", () => {
  const prepared = prepareAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    existingStudentCommand(),
    ADMIN_ACTOR,
    context("legacy-pending"),
  );
  const legacy = structuredClone({ ...prepared.draft, revision: 1 });
  const [legacyAction] = legacy.pendingActions;
  legacyAction.requestedBy = legacyAction.initiatedBy;
  legacyAction.requestedThroughAgentId = legacyAction.preparedByAgentId;
  delete legacyAction.initiatedBy;
  delete legacyAction.preparedByAgentId;
  delete legacyAction.specialistRole;

  const migrated = parseBookingWorkspace(legacy);

  assert.equal(migrated.pendingActions[0].initiatedBy, "owner-one");
  assert.equal(
    migrated.pendingActions[0].preparedByAgentId,
    "administrator-one",
  );
  assert.equal(migrated.pendingActions[0].specialistRole, "administrator");
});

test("legacy Fizz entity sources migrate to buzz_agent", () => {
  const enrolled = executeAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    existingStudentCommand(),
    ACTOR,
    context("legacy-enrollment-source"),
  );
  const legacyEnrollment = savedWorkspace(enrolled.draft, 1);
  legacyEnrollment.enrollments[0].source = "fizz";
  assert.equal(
    parseBookingWorkspace(legacyEnrollment).enrollments[0].source,
    "buzz_agent",
  );

  const booked = executeAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    {
      type: "AddLessonParticipant",
      submissionMode: "direct",
      client: newClient(),
      lessonRef: LESSON_REF,
      visitKind: "trial",
      sourceChannel: "telegram",
    },
    ACTOR,
    context("legacy-booking-source"),
  );
  const legacyBooking = savedWorkspace(booked.draft, 1);
  legacyBooking.bookings[0].source.surface = "fizz";
  assert.equal(
    parseBookingWorkspace(legacyBooking).bookings[0].source.surface,
    "buzz_agent",
  );
});

test("Administrator preview and commit create a pending lesson request", () => {
  const prepared = prepareAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    {
      type: "AddLessonParticipant",
      submissionMode: "request",
      client: newClient(),
      lessonRef: LESSON_REF,
      visitKind: "trial",
      sourceChannel: "telegram",
    },
    ADMIN_ACTOR,
    context("administrator-request-preview"),
  );
  const withPreview = savedWorkspace(prepared.draft, 1);

  assert.equal(withPreview.bookings.length, 0);
  assert.equal(withPreview.families.length, 0);
  assert.equal(withPreview.pendingActions.length, 1);
  assert.ok(prepared.preview.lines.includes("Статус: Новая заявка"));

  const committed = commitAirhopAction(
    withPreview,
    prepared.action.id,
    "owner-one",
    context("administrator-request-commit"),
  );
  const workspace = savedWorkspace(committed.draft, 2);

  assert.equal(workspace.bookings.length, 1);
  assert.equal(workspace.bookings[0].status, "pending_confirmation");
  assert.equal(workspace.bookings[0].source.surface, "buzz_agent");
  assert.equal(workspace.bookings[0].source.workflow, "request");
  assert.equal(workspace.pendingActions[0].status, "committed");
});

test("Fizz cannot prepare domain mutations", () => {
  assert.throws(
    () =>
      prepareAirhopAction(
        DEMO_BOOKING_WORKSPACE,
        existingStudentCommand(),
        FIZZ_AGENT,
        context("fizz-prepare"),
      ),
    /cannot prepare mutations/,
  );
});

test("expired preview changes status without creating business records", () => {
  const prepared = prepareAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    existingStudentCommand(),
    ADMIN_ACTOR,
    context("expired-preview"),
  );
  const withPreview = savedWorkspace(prepared.draft, 1);
  const expired = commitAirhopAction(
    withPreview,
    prepared.action.id,
    "owner-one",
    context("expired-commit", "2026-08-06T09:00:01.000Z"),
  );
  const saved = savedWorkspace(expired.draft, 2);

  assert.equal(expired.status, "expired");
  assert.equal(saved.pendingActions[0].status, "expired");
  assert.equal(saved.families.length, 0);
  assert.equal(saved.enrollments.length, 0);
});

test("unassigned request does not occupy a lesson seat", () => {
  const result = executeAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    {
      type: "CreateUnassignedRequest",
      client: newClient(),
      branchId: "kurskaya",
      groupId: "robotics-junior",
      sourceChannel: "visit",
    },
    ACTOR,
    context("intake"),
  );
  const workspace = savedWorkspace(result.draft, 1);

  assert.equal(workspace.intakeRequests.length, 1);
  assert.equal(workspace.intakeRequests[0].status, "new");
  assert.equal(workspace.bookings.length, 0);
});

test("MarkAttendance sets and clears a record through the same service", () => {
  const base = executeAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    existingStudentCommand(),
    ACTOR,
    context("attendance-student"),
  );
  const withStudent = savedWorkspace(base.draft, 1);
  const childId = withStudent.children[0].id;
  const marked = executeAirhopAction(
    withStudent,
    {
      type: "MarkAttendance",
      childId,
      lessonRef: LESSON_REF,
      status: "present",
    },
    ACTOR,
    context("attendance-present"),
  );
  const withAttendance = savedWorkspace(marked.draft, 2);
  assert.equal(withAttendance.attendanceRecords[0].status, "present");

  const cleared = executeAirhopAction(
    withAttendance,
    {
      type: "MarkAttendance",
      childId,
      lessonRef: LESSON_REF,
      status: null,
    },
    ACTOR,
    context("attendance-clear"),
  );
  const withoutAttendance = savedWorkspace(cleared.draft, 3);
  assert.deepEqual(withoutAttendance.attendanceRecords, []);
});

test("MarkAttendance rejects a child outside the lesson roster", () => {
  const base = executeAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    existingStudentCommand(),
    ACTOR,
    context("attendance-outsider"),
  );
  const withStudent = savedWorkspace(base.draft, 1);

  assert.throws(
    () =>
      executeAirhopAction(
        withStudent,
        {
          type: "MarkAttendance",
          childId: withStudent.children[0].id,
          lessonRef: {
            recurrenceRuleId: "animation-weekly",
            originalDate: "2026-08-10",
          },
          status: "present",
        },
        ACTOR,
        context("attendance-invalid"),
      ),
    (error) =>
      error instanceof AirhopActionError &&
      error.code === "attendance_participant_missing",
  );
});

test("staff and Administrator commerce commands share previews and mutations", () => {
  const createdTariff = executeAirhopAction(
    DEMO_BOOKING_WORKSPACE,
    {
      type: "CreateTariff",
      name: "Индивидуальный",
      description: "Один день в неделю",
      priceMinor: 450_000,
      currency: "RUB",
      weeklyScheduleLimit: 1,
      paymentDayOfMonth: 10,
    },
    ACTOR,
    context("tariff-create"),
  );
  const withTariff = savedWorkspace(createdTariff.draft, 1);
  const tariff = withTariff.tariffs.find(
    (candidate) => candidate.name === "Индивидуальный",
  );
  assert.equal(tariff.priceMinor, 450_000);
  assert.match(createdTariff.preview.lines.join("\n"), /450.?000|4.?500/);

  const enrolled = executeAirhopAction(
    withTariff,
    existingStudentCommand(),
    ACTOR,
    context("commerce-enrollment"),
  );
  const withPayment = savedWorkspace(enrolled.draft, 2);
  const paymentId = withPayment.paymentExpectations[0].id;
  const amountPreview = prepareAirhopAction(
    withPayment,
    {
      type: "UpdatePaymentAmount",
      paymentId,
      amountMinor: 300_000,
    },
    ADMIN_ACTOR,
    context("payment-amount-preview"),
  );
  const pendingAmount = savedWorkspace(amountPreview.draft, 3);
  assert.equal(pendingAmount.paymentExpectations[0].amountMinor, 600_000);
  assert.match(amountPreview.preview.lines.join("\n"), /3.?000/);

  const changed = commitAirhopAction(
    pendingAmount,
    amountPreview.action.id,
    "owner-one",
    context("payment-amount-commit"),
  );
  const changedWorkspace = savedWorkspace(changed.draft, 4);
  assert.equal(changedWorkspace.paymentExpectations[0].amountMinor, 300_000);

  const paid = executeAirhopAction(
    changedWorkspace,
    { type: "SetPaymentStatus", paymentId, status: "paid" },
    ACTOR,
    context("payment-paid"),
  );
  assert.equal(paid.draft.paymentExpectations[0].status, "paid");
  assert.equal(paid.draft.paymentExpectations[0].paidBy, ACTOR.userId);
});

test("Buzz agents cannot bypass preview and confirmation", () => {
  assert.throws(
    () =>
      executeAirhopAction(
        DEMO_BOOKING_WORKSPACE,
        {
          type: "CreateTariff",
          name: "Без подтверждения",
          priceMinor: 100_000,
          currency: "RUB",
          weeklyScheduleLimit: 1,
        },
        ADMIN_ACTOR,
        context("buzz-agent-bypass"),
      ),
    (error) =>
      error instanceof AirhopActionError && error.code === "invalid_actor",
  );
});
