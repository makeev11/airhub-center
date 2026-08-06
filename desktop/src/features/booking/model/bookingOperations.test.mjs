import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_BOOKING_WORKSPACE } from "./demoSchedule.ts";
import { parseBookingWorkspace } from "./bookingCore.ts";
import { materializeScheduleOccurrence } from "./materializeSchedule.ts";
import * as operations from "./bookingOperations.ts";
import * as mutations from "./bookingMutations.ts";

const LESSON_REF = {
  recurrenceRuleId: "robotics-junior-weekly",
  originalDate: "2026-08-03",
};
const NOW = "2026-08-05T09:00:00.000Z";

function workspaceWithClient() {
  return parseBookingWorkspace({
    ...DEMO_BOOKING_WORKSPACE,
    families: [
      {
        id: "family-one",
        organizationId: "airhop",
        displayName: "Семья Соколовых",
        primaryRepresentativeId: "representative-one",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    representatives: [
      {
        id: "representative-one",
        organizationId: "airhop",
        familyId: "family-one",
        displayName: "Ирина Соколова",
        phoneNormalized: "+79991234567",
        phoneDisplay: "+7 999 123-45-67",
        preferredContactChannel: "telegram",
        messengerAccounts: [],
        consentVersion: "privacy-v1",
        consentAcceptedAt: NOW,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    children: [
      {
        id: "child-one",
        organizationId: "airhop",
        familyId: "family-one",
        displayName: "Лев Соколов",
        birthDate: "2020-08-10",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  });
}

function savedWorkspace(draft, revision = 1) {
  return parseBookingWorkspace({ ...draft, revision });
}

function enrollment(overrides = {}) {
  return {
    id: "enrollment-one",
    organizationId: "airhop",
    familyId: "family-one",
    childId: "child-one",
    groupId: "robotics-junior",
    startDate: "2026-08-01",
    status: "active",
    source: "staff_ui",
    createdBy: "owner-one",
    assignmentState: "needs_assignment",
    weeklyScheduleSelections: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

test("configured enrollment covers only selected original weekly slots", () => {
  const configured = enrollment({
    assignmentState: "configured",
    tariffId: "tariff-weekly-1",
    weeklyScheduleSelections: [
      { recurrenceRuleId: LESSON_REF.recurrenceRuleId, weekday: "monday" },
    ],
  });
  assert.equal(
    operations.enrollmentCoversLesson(configured, {
      groupId: "robotics-junior",
      date: "2026-08-03",
      lessonRef: LESSON_REF,
    }),
    true,
  );
  assert.equal(
    operations.enrollmentCoversLesson(configured, {
      groupId: "robotics-junior",
      date: "2026-08-05",
      lessonRef: {
        recurrenceRuleId: "robotics-junior-wednesday",
        originalDate: "2026-08-05",
      },
    }),
    false,
  );
});

test("configured enrollment follows a moved occurrence by original weekday", () => {
  const configured = enrollment({
    assignmentState: "configured",
    tariffId: "tariff-weekly-1",
    weeklyScheduleSelections: [
      { recurrenceRuleId: LESSON_REF.recurrenceRuleId, weekday: "monday" },
    ],
  });
  assert.equal(
    operations.enrollmentCoversLesson(configured, {
      groupId: "robotics-junior",
      date: "2026-08-05",
      lessonRef: LESSON_REF,
    }),
    true,
  );
});

test("needs_assignment enrollment temporarily covers the whole group", () => {
  assert.equal(
    operations.enrollmentCoversLesson(enrollment(), {
      groupId: "robotics-junior",
      date: "2026-08-05",
      lessonRef: {
        recurrenceRuleId: "robotics-junior-wednesday",
        originalDate: "2026-08-05",
      },
    }),
    true,
  );
});

test("single visit permission resolves occurrence, group, then center and defaults off", () => {
  const center = structuredClone(DEMO_BOOKING_WORKSPACE);
  const centerOccurrence = materializeScheduleOccurrence(
    center,
    LESSON_REF.recurrenceRuleId,
    LESSON_REF.originalDate,
  );
  assert.equal(centerOccurrence?.singleVisitAllowed, false);

  const group = structuredClone(center);
  group.groups.find(
    ({ id }) => id === "robotics-junior",
  ).allowSingleVisitsOverride = true;
  const groupOccurrence = materializeScheduleOccurrence(
    group,
    LESSON_REF.recurrenceRuleId,
    LESSON_REF.originalDate,
  );
  assert.equal(groupOccurrence?.singleVisitAllowed, true);

  const lesson = structuredClone(group);
  lesson.lessonExceptions.push({
    id: "robotics-single-visit-off",
    organizationId: "airhop",
    recurrenceRuleId: LESSON_REF.recurrenceRuleId,
    originalDate: LESSON_REF.originalDate,
    original: {
      startTime: "10:00",
      endTime: "11:00",
      branchId: "kurskaya",
      roomId: "robotics-junior-room",
      teacherIds: ["teacher-1"],
    },
    kind: "override",
    override: { allowSingleVisits: false },
  });
  const lessonOccurrence = materializeScheduleOccurrence(
    parseBookingWorkspace(lesson),
    LESSON_REF.recurrenceRuleId,
    LESSON_REF.originalDate,
  );
  assert.equal(lessonOccurrence?.singleVisitAllowed, false);
});

test("attendance tracking resolves group override before center default", () => {
  const inherited = materializeScheduleOccurrence(
    DEMO_BOOKING_WORKSPACE,
    LESSON_REF.recurrenceRuleId,
    LESSON_REF.originalDate,
  );
  assert.equal(inherited?.trackAttendance, true);

  const disabled = structuredClone(DEMO_BOOKING_WORKSPACE);
  disabled.groups.find(
    ({ id }) => id === "robotics-junior",
  ).trackAttendanceOverride = false;
  const overridden = materializeScheduleOccurrence(
    disabled,
    LESSON_REF.recurrenceRuleId,
    LESSON_REF.originalDate,
  );
  assert.equal(overridden?.trackAttendance, false);
});

test("cancelling a lesson preserves its one-off visit override", () => {
  const workspace = structuredClone(DEMO_BOOKING_WORKSPACE);
  workspace.groups.find(
    ({ id }) => id === "robotics-junior",
  ).allowSingleVisitsOverride = true;
  workspace.lessonExceptions.push({
    id: "robotics-single-visit-off",
    organizationId: "airhop",
    recurrenceRuleId: LESSON_REF.recurrenceRuleId,
    originalDate: LESSON_REF.originalDate,
    original: {
      startTime: "10:00",
      endTime: "11:00",
      branchId: "kurskaya",
      roomId: "robotics-junior-room",
      teacherIds: ["teacher-1"],
    },
    kind: "override",
    override: { allowSingleVisits: false },
  });
  const withOverride = parseBookingWorkspace(workspace);
  const cancelledDraft = mutations.upsertBookingLessonException(withOverride, {
    id: "robotics-single-visit-off",
    recurrenceRuleId: LESSON_REF.recurrenceRuleId,
    originalDate: LESSON_REF.originalDate,
    kind: "cancelled",
    updatedAt: NOW,
  });
  const cancelled = savedWorkspace(cancelledDraft);

  assert.equal(
    materializeScheduleOccurrence(
      cancelled,
      LESSON_REF.recurrenceRuleId,
      LESSON_REF.originalDate,
    )?.singleVisitAllowed,
    false,
  );
});

test("enrollment activity follows status and date bounds", () => {
  assert.equal(
    operations.isEnrollmentActiveOn(enrollment(), "2026-08-03"),
    true,
  );
  assert.equal(
    operations.isEnrollmentActiveOn(enrollment(), "2026-07-31"),
    false,
  );
  assert.equal(
    operations.isEnrollmentActiveOn(
      enrollment({ endDate: "2026-08-02" }),
      "2026-08-03",
    ),
    false,
  );
  assert.equal(
    operations.isEnrollmentActiveOn(
      enrollment({ status: "paused" }),
      "2026-08-03",
    ),
    false,
  );
});

test("lesson occupancy counts unique enrolled and booked children", () => {
  const workspace = workspaceWithClient();
  const withParticipant = parseBookingWorkspace({
    ...workspace,
    enrollments: [enrollment()],
    bookings: [
      {
        id: "booking-one",
        organizationId: "airhop",
        familyId: "family-one",
        representativeId: "representative-one",
        childId: "child-one",
        lessonRef: LESSON_REF,
        applicant: {
          parentName: "Ирина Соколова",
          phoneNormalized: "+79991234567",
          phoneDisplay: "+7 999 123-45-67",
          childName: "Лев Соколов",
          childBirthDate: "2020-08-10",
          consentVersion: "staff-entry-v1",
          consentAcceptedAt: NOW,
          preferredContactChannel: "telegram",
        },
        visitKind: "trial",
        status: "pending_confirmation",
        transferRequest: null,
        managementTokenDigest: "a".repeat(64),
        idempotencyKeyDigest: "b".repeat(64),
        source: {
          surface: "staff_ui",
          purpose: "trial",
          channel: "phone",
        },
        createdBy: "owner-one",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  });

  assert.equal(
    operations.lessonOccupancy(withParticipant, {
      groupId: "robotics-junior",
      date: LESSON_REF.originalDate,
      lessonRef: LESSON_REF,
    }),
    1,
  );
  assert.deepEqual(
    [
      ...operations.lessonParticipantChildIds(withParticipant, {
        groupId: "robotics-junior",
        date: LESSON_REF.originalDate,
        lessonRef: LESSON_REF,
      }),
    ],
    ["child-one"],
  );
});

test("enrollment mutation rejects overlapping active membership", () => {
  const workspace = workspaceWithClient();
  const firstDraft = mutations.createEnrollment(workspace, enrollment());
  const withFirst = savedWorkspace(firstDraft);

  assert.equal(withFirst.enrollments.length, 1);
  assert.throws(
    () =>
      mutations.createEnrollment(
        withFirst,
        enrollment({ id: "enrollment-two", startDate: "2026-08-03" }),
      ),
    /already enrolled/i,
  );
});

test("attendance can be set, replaced, and cleared without changing bookings or enrollments", () => {
  const workspace = workspaceWithClient();
  const baselineBookings = structuredClone(workspace.bookings);
  const baselineEnrollments = structuredClone(workspace.enrollments);
  const presentDraft = mutations.upsertAttendanceRecord(workspace, {
    id: "attendance-one",
    organizationId: "airhop",
    childId: "child-one",
    lessonRef: LESSON_REF,
    status: "present",
    markedBy: "owner-one",
    markedAt: NOW,
    updatedAt: NOW,
  });
  const present = savedWorkspace(presentDraft);
  assert.equal(present.attendanceRecords[0].status, "present");

  const absentDraft = mutations.upsertAttendanceRecord(present, {
    ...present.attendanceRecords[0],
    status: "absent",
    updatedAt: "2026-08-05T10:00:00.000Z",
  });
  const absent = savedWorkspace(absentDraft, 2);
  assert.equal(absent.attendanceRecords.length, 1);
  assert.equal(absent.attendanceRecords[0].status, "absent");

  const clearedDraft = mutations.clearAttendanceRecord(
    absent,
    "child-one",
    LESSON_REF,
  );
  const cleared = savedWorkspace(clearedDraft, 3);
  assert.deepEqual(cleared.attendanceRecords, []);
  assert.deepEqual(cleared.bookings, baselineBookings);
  assert.deepEqual(cleared.enrollments, baselineEnrollments);
});
