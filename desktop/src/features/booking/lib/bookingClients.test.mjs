import assert from "node:assert/strict";
import test from "node:test";

import {
  bookingRequestRows,
  familyBookings,
  lessonRoster,
  searchFamilySummaries,
} from "./bookingClients.ts";
import { parseBookingWorkspace } from "../model/bookingCore.ts";
import { DEMO_BOOKING_WORKSPACE } from "../model/demoSchedule.ts";

const CREATED_AT = "2026-08-04T08:00:00.000Z";

function familyFixture(index, overrides = {}) {
  const id = `family-${index}`;
  const representativeId = `representative-${index}`;
  const childId = `child-${index}`;
  return {
    family: {
      id,
      organizationId: "airhop",
      displayName: `Семья ${index}`,
      primaryRepresentativeId: representativeId,
      status: "active",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      ...overrides.family,
    },
    representative: {
      id: representativeId,
      organizationId: "airhop",
      familyId: id,
      displayName: `Родитель ${index}`,
      phoneNormalized: `+7999000000${index}`,
      phoneDisplay: `+7 999 000-00-0${index}`,
      preferredContactChannel: "telegram",
      messengerAccounts: [],
      consentVersion: "public-booking-v1",
      consentAcceptedAt: CREATED_AT,
      status: "active",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      ...overrides.representative,
    },
    child: {
      id: childId,
      organizationId: "airhop",
      familyId: id,
      displayName: `Ребёнок ${index}`,
      birthDate: `2020-0${index}-01`,
      status: "active",
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
      ...overrides.child,
    },
  };
}

function bookingFixture(index, overrides = {}) {
  const digest = String(index).repeat(64);
  const idempotency = String.fromCharCode(97 + Number(index)).repeat(64);
  return {
    id: `booking-${overrides.id ?? index}`,
    organizationId: "airhop",
    familyId: `family-${index}`,
    representativeId: `representative-${index}`,
    childId: `child-${index}`,
    lessonRef: {
      recurrenceRuleId: "public-limited-weekly",
      originalDate: `2026-08-${String(3 + Number(index) * 7).padStart(2, "0")}`,
    },
    applicant: {
      parentName: `Родитель ${index}`,
      phoneNormalized: `+7999000000${index}`,
      phoneDisplay: `+7 999 000-00-0${index}`,
      childName: `Ребёнок ${index}`,
      childBirthDate: `2020-0${index}-01`,
      consentVersion: "public-booking-v1",
      consentAcceptedAt: CREATED_AT,
      preferredContactChannel: "telegram",
    },
    visitKind: "trial",
    status: "confirmed",
    transferRequest: null,
    managementTokenDigest: digest,
    idempotencyKeyDigest: idempotency,
    source: {
      surface: "embedded",
      purpose: "trial",
      channel: "website",
    },
    createdBy: "public-booking",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    ...overrides,
  };
}

function workspaceFixture() {
  const records = [
    familyFixture(1, {
      family: { displayName: "Семья Ёлкиных" },
      representative: { displayName: "Алёна Ёлкина" },
      child: { displayName: "Лев Ёлкин" },
    }),
    familyFixture(2),
    familyFixture(3),
    familyFixture(4),
  ];
  return parseBookingWorkspace({
    ...DEMO_BOOKING_WORKSPACE,
    families: records.map((record) => record.family),
    representatives: records.map((record) => record.representative),
    children: records.map((record) => record.child),
    duplicateCandidates: [
      {
        id: "duplicate-candidate-1",
        organizationId: "airhop",
        newEntityType: "representative",
        newEntityId: "representative-3",
        existingEntityType: "representative",
        existingEntityId: "representative-1",
        signals: ["phone"],
        status: "pending",
        createdAt: "2026-08-05T08:00:00.000Z",
      },
    ],
    bookings: [
      bookingFixture(4, {
        id: "rejected",
        status: "rejected",
        updatedAt: "2026-08-05T12:00:00.000Z",
      }),
      bookingFixture(3, {
        id: "duplicate",
        updatedAt: "2026-08-05T09:00:00.000Z",
      }),
      bookingFixture(2, {
        id: "transfer",
        transferRequest: {
          status: "pending",
          requestedAt: "2026-08-05T10:00:00.000Z",
        },
        updatedAt: "2026-08-05T10:00:00.000Z",
      }),
      bookingFixture(1, {
        id: "pending",
        status: "pending_confirmation",
        updatedAt: "2026-08-05T08:00:00.000Z",
      }),
    ],
  });
}

test("request rows prioritize pending, transfer, duplicate attention, then processed", () => {
  const rows = bookingRequestRows(workspaceFixture());

  assert.deepEqual(
    rows.map((row) => row.booking.id),
    ["pending", "transfer", "duplicate", "rejected"],
  );
  assert.deepEqual(
    rows.map((row) => row.requiresAttention),
    [true, true, true, false],
  );
  assert.equal(rows[0].groupName, "Открытая лаборатория");
  assert.equal(rows[0].branchName, "Курская");
});

test("request rows exclude direct staff bookings but keep confirmed requests", () => {
  const workspace = workspaceFixture();
  const withDirectBooking = parseBookingWorkspace({
    ...workspace,
    bookings: [
      ...workspace.bookings,
      bookingFixture(4, {
        id: "direct",
        managementTokenDigest: "9".repeat(64),
        idempotencyKeyDigest: "f".repeat(64),
        lessonRef: {
          recurrenceRuleId: "public-limited-weekly",
          originalDate: "2026-08-17",
        },
        source: {
          surface: "staff_ui",
          purpose: "trial",
          channel: "phone",
          workflow: "direct",
        },
      }),
    ],
  });

  const rows = bookingRequestRows(withDirectBooking);

  assert.equal(
    rows.some((row) => row.kind === "booking" && row.booking.id === "direct"),
    false,
  );
  assert.equal(
    rows.some(
      (row) => row.kind === "booking" && row.booking.id === "duplicate",
    ),
    true,
  );
});

test("request rows merge unassigned intake requests without reserving a lesson", () => {
  const workspace = workspaceFixture();
  const withIntake = parseBookingWorkspace({
    ...workspace,
    intakeRequests: [
      {
        id: "intake-new",
        organizationId: "airhop",
        familyId: "family-4",
        representativeId: "representative-4",
        childId: "child-4",
        branchId: "kurskaya",
        sourceChannel: "phone",
        internalComment: "Нужно подобрать занятие после 18:00",
        status: "new",
        createdBy: "staff-1",
        createdAt: "2026-08-05T13:00:00.000Z",
        updatedAt: "2026-08-05T13:00:00.000Z",
      },
    ],
  });

  const rows = bookingRequestRows(withIntake);
  const intakeRow = rows.find((row) => row.kind === "intake");

  assert.equal(rows.filter((row) => row.kind === "booking").length, 4);
  assert.equal(intakeRow.request.id, "intake-new");
  assert.equal(intakeRow.branchName, "Курская");
  assert.equal(intakeRow.groupName, undefined);
  assert.equal(intakeRow.date, undefined);
  assert.equal(intakeRow.requiresAttention, true);
});

test("family search ignores case, accents, spacing, and phone punctuation", () => {
  const workspace = workspaceFixture();

  assert.deepEqual(
    searchFamilySummaries(workspace, "  АЛЕНА ").map(({ family }) => family.id),
    ["family-1"],
  );
  assert.deepEqual(
    searchFamilySummaries(workspace, "лев елкин").map(
      ({ family }) => family.id,
    ),
    ["family-1"],
  );
  assert.deepEqual(
    searchFamilySummaries(workspace, "9990000001").map(
      ({ family }) => family.id,
    ),
    ["family-1"],
  );
});

test("lesson roster keeps pending and confirmed bookings but excludes terminal statuses", () => {
  const workspace = workspaceFixture();
  const lessonRef = workspace.bookings[0].lessonRef;
  const bookings = [
    bookingFixture(1, {
      id: "roster-pending",
      lessonRef,
      status: "pending_confirmation",
    }),
    bookingFixture(2, {
      id: "roster-confirmed",
      lessonRef,
      status: "confirmed",
    }),
    bookingFixture(3, { id: "roster-rejected", lessonRef, status: "rejected" }),
    bookingFixture(4, {
      id: "roster-cancelled",
      lessonRef,
      status: "cancelled_by_parent",
    }),
  ];
  const rosterWorkspace = parseBookingWorkspace({ ...workspace, bookings });

  assert.deepEqual(
    lessonRoster(rosterWorkspace, lessonRef).map((entry) => entry.booking.id),
    ["roster-pending", "roster-confirmed"],
  );
});

test("lesson roster combines active enrollments and bookings without duplicating a child", () => {
  const workspace = workspaceFixture();
  const lessonRef = {
    recurrenceRuleId: "public-limited-weekly",
    originalDate: "2026-08-10",
  };
  const withRosterSources = parseBookingWorkspace({
    ...workspace,
    bookings: [
      bookingFixture(1, {
        id: "same-child-booking",
        lessonRef,
        status: "pending_confirmation",
      }),
    ],
    enrollments: [
      {
        id: "enrollment-same-child",
        organizationId: "airhop",
        familyId: "family-1",
        childId: "child-1",
        groupId: "public-limited",
        startDate: "2026-08-01",
        status: "active",
        source: "staff_ui",
        createdBy: "staff-1",
        assignmentState: "needs_assignment",
        weeklyScheduleSelections: [],
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      {
        id: "enrollment-only",
        organizationId: "airhop",
        familyId: "family-2",
        childId: "child-2",
        groupId: "public-limited",
        startDate: "2026-08-10",
        status: "active",
        source: "staff_ui",
        createdBy: "staff-1",
        assignmentState: "needs_assignment",
        weeklyScheduleSelections: [],
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
      {
        id: "enrollment-paused",
        organizationId: "airhop",
        familyId: "family-3",
        childId: "child-3",
        groupId: "public-limited",
        startDate: "2026-08-01",
        status: "paused",
        source: "staff_ui",
        createdBy: "staff-1",
        assignmentState: "needs_assignment",
        weeklyScheduleSelections: [],
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      },
    ],
    attendanceRecords: [
      {
        id: "attendance-child-1",
        organizationId: "airhop",
        childId: "child-1",
        lessonRef,
        status: "present",
        markedBy: "staff-2",
        markedAt: "2026-08-10T14:10:00.000Z",
        updatedAt: "2026-08-10T14:10:00.000Z",
      },
    ],
  });

  const roster = lessonRoster(withRosterSources, lessonRef);

  assert.deepEqual(
    roster.map((entry) => entry.child.id),
    ["child-1", "child-2"],
  );
  assert.equal(roster[0].source, "enrollment_and_booking");
  assert.equal(roster[0].booking.id, "same-child-booking");
  assert.equal(roster[0].enrollment.id, "enrollment-same-child");
  assert.equal(roster[0].attendance.status, "present");
  assert.equal(roster[0].attendance.markedBy, "staff-2");
  assert.equal(roster[1].source, "enrollment");
  assert.equal(roster[1].booking, undefined);
  assert.equal(roster[1].representative.id, "representative-2");
});

test("family history contains only bookings linked to that family", () => {
  const rows = familyBookings(workspaceFixture(), "family-2");
  assert.deepEqual(
    rows.map((row) => row.booking.id),
    ["transfer"],
  );
});
