import assert from "node:assert/strict";
import test from "node:test";

import {
  findPublicBookingOccurrences,
  publicOccurrenceOccupancy,
  resolveStablePublicOccurrence,
} from "./publicBookingAvailability.ts";
import { parseBookingWorkspace } from "../model/bookingCore.ts";
import {
  restoreBookingLessonToSeries,
  upsertBookingLessonException,
} from "../model/bookingMutations.ts";
import { DEMO_BOOKING_WORKSPACE } from "../model/demoSchedule.ts";

const NOW = new Date("2026-08-04T09:00:00.000Z");
const LIMITED_REF = {
  recurrenceRuleId: "public-limited-weekly",
  originalDate: "2026-08-10",
};

const TEST_CLIENT_RECORDS = {
  families: [
    {
      id: "capacity-family",
      organizationId: "airhop",
      displayName: "Семья Льва",
      primaryRepresentativeId: "capacity-representative",
      status: "active",
      createdAt: "2026-08-04T09:00:00.000Z",
      updatedAt: "2026-08-04T09:00:00.000Z",
    },
  ],
  representatives: [
    {
      id: "capacity-representative",
      organizationId: "airhop",
      familyId: "capacity-family",
      displayName: "Мария",
      phoneNormalized: "+79991234567",
      phoneDisplay: "+7 999 123-45-67",
      preferredContactChannel: "none",
      messengerAccounts: [],
      consentVersion: "public-booking-v1",
      consentAcceptedAt: "2026-08-04T09:00:00.000Z",
      status: "active",
      createdAt: "2026-08-04T09:00:00.000Z",
      updatedAt: "2026-08-04T09:00:00.000Z",
    },
  ],
  children: [
    {
      id: "capacity-child",
      organizationId: "airhop",
      familyId: "capacity-family",
      displayName: "Лев",
      birthDate: "2020-08-10",
      status: "active",
      createdAt: "2026-08-04T09:00:00.000Z",
      updatedAt: "2026-08-04T09:00:00.000Z",
    },
  ],
};

function savedWorkspace(draft, revision = 1) {
  return parseBookingWorkspace({ ...draft, revision });
}

function capacityBooking(status = "pending_confirmation", id = "one") {
  return {
    id: `booking-${id}`,
    organizationId: "airhop",
    familyId: "capacity-family",
    representativeId: "capacity-representative",
    childId: "capacity-child",
    lessonRef: LIMITED_REF,
    applicant: {
      parentName: "Мария",
      phoneNormalized: "+79991234567",
      phoneDisplay: "+7 999 123-45-67",
      childName: "Лев",
      childBirthDate: "2020-08-10",
      consentVersion: "public-booking-v1",
      consentAcceptedAt: "2026-08-04T09:00:00.000Z",
      preferredContactChannel: "none",
    },
    visitKind: "trial",
    status,
    transferRequest: null,
    managementTokenDigest: "a".repeat(64),
    idempotencyKeyDigest: "b".repeat(64),
    source: {
      surface: "standalone",
      purpose: "trial",
      channel: "website",
    },
    createdBy: "public-booking",
    createdAt: "2026-08-04T09:00:00.000Z",
    updatedAt: "2026-08-04T09:00:00.000Z",
  };
}

test("public catalog exposes only future active trial-enabled occurrences", () => {
  const occurrences = findPublicBookingOccurrences(
    DEMO_BOOKING_WORKSPACE,
    {},
    { now: NOW, includeFull: true },
  );

  assert.ok(occurrences.length > 0);
  assert.equal(
    occurrences.some((occurrence) => occurrence.groupId === "public-disabled"),
    false,
  );
  assert.equal(
    occurrences.some(
      (occurrence) =>
        occurrence.groupId === "theatre" &&
        occurrence.lessonRef.originalDate === "2026-08-05",
    ),
    false,
  );
  assert.ok(
    occurrences.some((occurrence) => occurrence.trialPolicy.mode === "free"),
  );
  assert.ok(
    occurrences.some((occurrence) => occurrence.trialPolicy.mode === "paid"),
  );
  assert.ok(
    occurrences.every(
      (occurrence) =>
        occurrence.date > "2026-08-04" || occurrence.startTime > "12:00",
    ),
  );
});

test("public catalog applies branch, group and birth-month filters", () => {
  const occurrences = findPublicBookingOccurrences(
    DEMO_BOOKING_WORKSPACE,
    {
      branchId: "kurskaya",
      groupId: "public-limited",
      birthYear: 2020,
      birthMonth: 8,
    },
    { now: NOW },
  );

  assert.ok(occurrences.length > 0);
  assert.ok(
    occurrences.every(
      (occurrence) =>
        occurrence.branchId === "kurskaya" &&
        occurrence.groupId === "public-limited",
    ),
  );
  assert.equal(
    findPublicBookingOccurrences(
      DEMO_BOOKING_WORKSPACE,
      {
        groupId: "public-limited",
        birthYear: 2010,
        birthMonth: 8,
      },
      { now: NOW },
    ).length,
    0,
  );
});

test("completed-age filtering stays simple while exact date remains deferred", () => {
  const occurrences = findPublicBookingOccurrences(
    DEMO_BOOKING_WORKSPACE,
    { branchId: "kurskaya", ageYears: 5 },
    { now: NOW },
  );

  assert.ok(
    occurrences.some((occurrence) => occurrence.groupId === "robotics-junior"),
  );
  assert.equal(
    occurrences.some((occurrence) => occurrence.groupId === "programming"),
    false,
  );
});

test("ordinary lesson widgets may expose groups where trials are disabled", () => {
  const trial = findPublicBookingOccurrences(
    DEMO_BOOKING_WORKSPACE,
    { groupId: "public-disabled", purpose: "trial" },
    { now: NOW },
  );
  const lesson = findPublicBookingOccurrences(
    DEMO_BOOKING_WORKSPACE,
    { groupId: "public-disabled", purpose: "lesson" },
    { now: NOW },
  );

  assert.equal(trial.length, 0);
  assert.ok(lesson.length > 0);
});

test("moved lessons retain the original occurrence identity", () => {
  const moved = findPublicBookingOccurrences(
    DEMO_BOOKING_WORKSPACE,
    { groupId: "english-play" },
    { now: NOW },
  ).find((occurrence) => occurrence.lessonRef.originalDate === "2026-08-05");

  assert.ok(moved);
  assert.equal(moved.date, "2026-08-05");
  assert.equal(moved.startTime, "11:00");
  assert.deepEqual(moved.lessonRef, {
    recurrenceRuleId: "english-play-weekly",
    originalDate: "2026-08-05",
  });
});

test("stable lesson references survive move, cancel and restore", () => {
  const moved = savedWorkspace(
    upsertBookingLessonException(DEMO_BOOKING_WORKSPACE, {
      id: "limited-move",
      recurrenceRuleId: LIMITED_REF.recurrenceRuleId,
      originalDate: LIMITED_REF.originalDate,
      kind: "override",
      override: {
        date: "2026-08-12",
        startTime: "13:00",
        endTime: "14:00",
      },
    }),
  );
  const movedOccurrence = resolveStablePublicOccurrence(moved, LIMITED_REF);
  assert.equal(movedOccurrence?.date, "2026-08-12");
  assert.equal(movedOccurrence?.originalDate, LIMITED_REF.originalDate);

  const cancelled = savedWorkspace(
    upsertBookingLessonException(moved, {
      id: "limited-move",
      recurrenceRuleId: LIMITED_REF.recurrenceRuleId,
      originalDate: LIMITED_REF.originalDate,
      kind: "cancelled",
      updatedAt: "2026-08-04T08:00:00.000Z",
    }),
    2,
  );
  const cancelledOccurrence = resolveStablePublicOccurrence(
    cancelled,
    LIMITED_REF,
  );
  assert.equal(cancelledOccurrence?.status, "cancelled");
  assert.equal(cancelledOccurrence?.originalDate, LIMITED_REF.originalDate);

  const restored = savedWorkspace(
    restoreBookingLessonToSeries(
      cancelled,
      LIMITED_REF.recurrenceRuleId,
      LIMITED_REF.originalDate,
    ),
    3,
  );
  const restoredOccurrence = resolveStablePublicOccurrence(
    restored,
    LIMITED_REF,
  );
  assert.equal(restoredOccurrence?.status, "scheduled");
  assert.equal(restoredOccurrence?.date, LIMITED_REF.originalDate);
});

test("pending and confirmed bookings hold capacity until start", () => {
  const occurrence = resolveStablePublicOccurrence(
    DEMO_BOOKING_WORKSPACE,
    LIMITED_REF,
  );
  assert.ok(occurrence);

  for (const status of ["pending_confirmation", "confirmed"]) {
    const workspace = parseBookingWorkspace({
      ...DEMO_BOOKING_WORKSPACE,
      ...TEST_CLIENT_RECORDS,
      bookings: [capacityBooking(status)],
    });
    const full = findPublicBookingOccurrences(
      workspace,
      { groupId: "public-limited" },
      { now: NOW, includeFull: true },
    ).find(
      (candidate) =>
        candidate.lessonRef.originalDate === LIMITED_REF.originalDate,
    );
    assert.equal(full?.occupied, 1);
    assert.equal(full?.remaining, 0);
    assert.equal(full?.available, false);
    const defaultPresentation = findPublicBookingOccurrences(
      workspace,
      { groupId: "public-limited" },
      { now: NOW },
    ).find(
      (candidate) =>
        candidate.lessonRef.originalDate === LIMITED_REF.originalDate,
    );
    assert.equal(defaultPresentation?.available, false);
    assert.equal(defaultPresentation?.remaining, 0);
  }

  for (const status of [
    "rejected",
    "cancelled_by_parent",
    "cancelled_by_center",
  ]) {
    const workspace = parseBookingWorkspace({
      ...DEMO_BOOKING_WORKSPACE,
      ...TEST_CLIENT_RECORDS,
      bookings: [capacityBooking(status)],
    });
    assert.equal(publicOccurrenceOccupancy(workspace, occurrence, NOW), 0);
  }

  const expired = parseBookingWorkspace({
    ...DEMO_BOOKING_WORKSPACE,
    ...TEST_CLIENT_RECORDS,
    bookings: [capacityBooking("pending_confirmation")],
  });
  assert.equal(
    publicOccurrenceOccupancy(
      expired,
      occurrence,
      new Date("2026-08-10T13:01:00.000Z"),
    ),
    0,
  );
});

test("an omitted capacity remains unlimited", () => {
  const chess = findPublicBookingOccurrences(
    DEMO_BOOKING_WORKSPACE,
    { groupId: "chess-start" },
    { now: NOW },
  )[0];

  assert.ok(chess);
  assert.equal(chess.capacity, null);
  assert.equal(chess.remaining, null);
  assert.equal(chess.available, true);
});
