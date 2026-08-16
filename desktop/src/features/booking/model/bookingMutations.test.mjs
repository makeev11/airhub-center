import assert from "node:assert/strict";
import test from "node:test";

import {
  BookingEntityMutationError,
  restoreBookingLessonToSeries,
  setBookingFamilyStatus,
  setBookingGroupStatus,
  setBookingRoomStatus,
  setBookingTeacherStatus,
  setStaffBookingStatus,
  upsertBookingChild,
  upsertBookingFamily,
  upsertBookingGroup,
  upsertBookingLessonException,
  upsertBookingRoom,
  upsertBookingTeacher,
  upsertBookingRepresentative,
} from "./bookingMutations.ts";
import { parseBookingWorkspace } from "./bookingCore.ts";
import { DEMO_BOOKING_WORKSPACE } from "./demoSchedule.ts";
import {
  materializeSchedule,
  materializeScheduleOccurrence,
} from "./materializeSchedule.ts";

function savedWorkspace(draft, revision = 1) {
  return parseBookingWorkspace({ ...draft, revision });
}

function publicBooking({ id, lessonRef, status, transferRequest = null }) {
  const digestCharacter = String(id).slice(-1).toLowerCase();
  return {
    id: `booking-${id}`,
    organizationId: "airhop",
    familyId: "family-test",
    representativeId: "representative-test",
    childId: "child-test",
    lessonRef,
    applicant: {
      parentName: "Мария",
      phoneNormalized: "+79991234567",
      phoneDisplay: "+7 999 123-45-67",
      childName: "Лев",
      childBirthDate: "2020-08-10",
      consentVersion: "public-booking-v1",
      consentAcceptedAt: "2026-08-04T08:00:00.000Z",
      preferredContactChannel: "none",
    },
    visitKind: "trial",
    status,
    transferRequest,
    managementTokenDigest: digestCharacter.repeat(64),
    idempotencyKeyDigest: String.fromCharCode(
      digestCharacter.charCodeAt(0) + 1,
    ).repeat(64),
    source: {
      surface: "standalone",
      purpose: "trial",
      channel: "website",
    },
    createdBy: "public-booking",
    createdAt: "2026-08-04T08:00:00.000Z",
    updatedAt: "2026-08-04T08:00:00.000Z",
  };
}

function clientCollections() {
  return {
    families: [
      {
        id: "family-test",
        organizationId: "airhop",
        displayName: "Семья Тестовая",
        primaryRepresentativeId: "representative-test",
        status: "active",
        createdAt: "2026-08-04T08:00:00.000Z",
        updatedAt: "2026-08-04T08:00:00.000Z",
      },
    ],
    representatives: [
      {
        id: "representative-test",
        organizationId: "airhop",
        familyId: "family-test",
        displayName: "Мария",
        phoneNormalized: "+79991234567",
        phoneDisplay: "+7 999 123-45-67",
        preferredContactChannel: "none",
        messengerAccounts: [],
        consentVersion: "public-booking-v1",
        consentAcceptedAt: "2026-08-04T08:00:00.000Z",
        status: "active",
        createdAt: "2026-08-04T08:00:00.000Z",
        updatedAt: "2026-08-04T08:00:00.000Z",
      },
    ],
    children: [
      {
        id: "child-test",
        organizationId: "airhop",
        familyId: "family-test",
        displayName: "Лев",
        birthDate: "2020-08-10",
        status: "active",
        createdAt: "2026-08-04T08:00:00.000Z",
        updatedAt: "2026-08-04T08:00:00.000Z",
      },
    ],
  };
}

test("teacher CRUD preserves group and schedule relationships across archive", () => {
  const created = savedWorkspace(
    upsertBookingTeacher(DEMO_BOOKING_WORKSPACE, {
      id: "teacher-new",
      organizationId: "airhop",
      displayName: "Новый преподаватель",
      buzzUsername: "teacher.new",
      status: "active",
    }),
  );
  assert.equal(created.teachers.at(-1)?.displayName, "Новый преподаватель");

  const teacherId = created.groups.find((group) => group.teacherIds.length > 0)
    .teacherIds[0];
  const archived = savedWorkspace(
    setBookingTeacherStatus(created, teacherId, "archived"),
    2,
  );
  assert.equal(
    archived.teachers.find((teacher) => teacher.id === teacherId)?.status,
    "archived",
  );
  assert.ok(
    archived.groups.some((group) => group.teacherIds.includes(teacherId)),
  );
  assert.ok(
    materializeSchedule(archived, {
      startsOn: "2026-08-03",
      endsOn: "2026-08-09",
    }).some((occurrence) => occurrence.teacherIds.includes(teacherId)),
  );

  const restored = savedWorkspace(
    setBookingTeacherStatus(archived, teacherId, "active"),
    3,
  );
  assert.equal(
    restored.teachers.find((teacher) => teacher.id === teacherId)?.status,
    "active",
  );
});

test("room CRUD and archive preserve existing group and lesson links", () => {
  const created = savedWorkspace(
    upsertBookingRoom(DEMO_BOOKING_WORKSPACE, {
      id: "kurskaya-new-room",
      organizationId: "airhop",
      branchId: "kurskaya",
      name: "Новый кабинет",
      status: "active",
    }),
  );
  assert.equal(created.rooms.at(-1)?.name, "Новый кабинет");

  const roomId = "robotics-junior-room";
  const archived = savedWorkspace(
    setBookingRoomStatus(created, roomId, "archived"),
    2,
  );
  assert.equal(
    archived.rooms.find((room) => room.id === roomId)?.status,
    "archived",
  );
  assert.equal(
    archived.groups.find((group) => group.id === "robotics-junior")?.roomId,
    roomId,
  );
  assert.equal(
    materializeSchedule(archived, {
      startsOn: "2026-08-03",
      endsOn: "2026-08-03",
    })[0]?.roomId,
    roomId,
  );

  const restored = savedWorkspace(
    setBookingRoomStatus(archived, roomId, "active"),
    3,
  );
  assert.equal(
    restored.rooms.find((room) => room.id === roomId)?.status,
    "active",
  );
});

test("group CRUD supports independent limits, inheritance overrides and multiple templates", () => {
  const group = {
    id: "group-new",
    organizationId: "airhop",
    branchId: "kurskaya",
    name: "Новая группа",
    teacherIds: [],
    minAgeMonths: 71,
    capacity: 9,
    trialPolicyOverride: {
      mode: "paid",
      price: { amountMinor: 75_000, currency: "RUB" },
    },
    trackAttendanceOverride: false,
    status: "active",
  };
  const rules = ["monday", "wednesday"].map((weekday, index) => ({
    id: `group-new-${index}`,
    organizationId: "airhop",
    groupId: group.id,
    startsOn: "2026-09-01",
    endsOn: "2026-12-31",
    weekdays: [weekday],
    startTime: "15:00",
    endTime: "16:00",
    status: "active",
  }));
  const created = savedWorkspace(
    upsertBookingGroup(DEMO_BOOKING_WORKSPACE, {
      group,
      activeRules: rules,
    }),
  );

  const saved = created.groups.find((candidate) => candidate.id === group.id);
  assert.equal(saved.minAgeMonths, 71);
  assert.equal(saved.maxAgeMonths, undefined);
  assert.equal(saved.capacity, 9);
  assert.equal(saved.trackAttendanceOverride, false);
  assert.equal(
    created.recurrenceRules.filter(
      (rule) => rule.groupId === group.id && rule.status === "active",
    ).length,
    2,
  );
});

test("editing templates archives removed rules and retains their lesson exceptions", () => {
  const sourceGroup = DEMO_BOOKING_WORKSPACE.groups.find(
    (group) => group.id === "english-play",
  );
  const sourceRule = DEMO_BOOKING_WORKSPACE.recurrenceRules.find(
    (rule) => rule.groupId === sourceGroup.id,
  );
  const replacement = {
    id: "english-play-new-series",
    organizationId: "airhop",
    groupId: sourceGroup.id,
    startsOn: "2026-09-01",
    endsOn: "2026-12-31",
    weekdays: ["friday"],
    startTime: "12:00",
    endTime: "13:00",
    status: "active",
  };
  const edited = savedWorkspace(
    upsertBookingGroup(DEMO_BOOKING_WORKSPACE, {
      group: { ...sourceGroup, name: "English Play 2" },
      activeRules: [replacement],
    }),
  );

  assert.equal(
    edited.recurrenceRules.find((rule) => rule.id === sourceRule.id)?.status,
    "archived",
  );
  assert.ok(
    edited.lessonExceptions.some(
      (exception) => exception.recurrenceRuleId === sourceRule.id,
    ),
  );
  assert.equal(
    materializeSchedule(edited, {
      startsOn: "2026-08-03",
      endsOn: "2026-08-09",
    }).some((occurrence) => occurrence.recurrenceRuleId === sourceRule.id),
    false,
  );
  assert.equal(
    materializeSchedule(
      edited,
      { startsOn: "2026-08-03", endsOn: "2026-08-09" },
      { includeArchived: true },
    ).some((occurrence) => occurrence.recurrenceRuleId === sourceRule.id),
    true,
  );
});

test("an existing recurrence rule cannot orphan a booked original date", () => {
  const group = DEMO_BOOKING_WORKSPACE.groups.find(
    (candidate) => candidate.id === "public-limited",
  );
  const rule = DEMO_BOOKING_WORKSPACE.recurrenceRules.find(
    (candidate) => candidate.id === "public-limited-weekly",
  );
  assert.ok(group);
  assert.ok(rule);
  const lessonRef = {
    recurrenceRuleId: rule.id,
    originalDate: "2026-08-10",
  };
  const workspace = parseBookingWorkspace({
    ...DEMO_BOOKING_WORKSPACE,
    ...clientCollections(),
    bookings: [
      publicBooking({ id: "a", lessonRef, status: "pending_confirmation" }),
    ],
  });

  assert.throws(
    () =>
      upsertBookingGroup(workspace, {
        group,
        activeRules: [{ ...rule, weekdays: ["tuesday"] }],
      }),
    (error) => {
      assert.ok(error instanceof BookingEntityMutationError);
      assert.match(
        error.message,
        /cannot exclude booked occurrence 2026-08-10/,
      );
      return true;
    },
  );

  const archived = savedWorkspace(
    upsertBookingGroup(workspace, { group, activeRules: [] }),
  );
  assert.equal(
    archived.recurrenceRules.find((candidate) => candidate.id === rule.id)
      ?.status,
    "archived",
  );
  assert.equal(
    materializeScheduleOccurrence(archived, rule.id, "2026-08-10")
      ?.originalDate,
    "2026-08-10",
  );
});

test("group archive and restore never delete rules or exceptions", () => {
  const group = DEMO_BOOKING_WORKSPACE.groups[0];
  const usageBefore = {
    rules: DEMO_BOOKING_WORKSPACE.recurrenceRules.filter(
      (rule) => rule.groupId === group.id,
    ).length,
    exceptions: DEMO_BOOKING_WORKSPACE.lessonExceptions.length,
  };
  const archived = savedWorkspace(
    setBookingGroupStatus(DEMO_BOOKING_WORKSPACE, group.id, "archived"),
  );
  assert.equal(
    archived.groups.find((candidate) => candidate.id === group.id)?.status,
    "archived",
  );
  assert.equal(
    archived.recurrenceRules.filter((rule) => rule.groupId === group.id).length,
    usageBefore.rules,
  );
  assert.equal(archived.lessonExceptions.length, usageBefore.exceptions);

  const restored = savedWorkspace(
    setBookingGroupStatus(archived, group.id, "active"),
    2,
  );
  assert.equal(
    restored.groups.find((candidate) => candidate.id === group.id)?.status,
    "active",
  );
});

test("lesson exception mutations cancel, move and restore exactly one occurrence", () => {
  const recurrenceRuleId = "robotics-junior-weekly";
  const originalDate = "2026-08-03";
  const cancelled = savedWorkspace(
    upsertBookingLessonException(DEMO_BOOKING_WORKSPACE, {
      id: "robotics-aug-3-exception",
      recurrenceRuleId,
      originalDate,
      kind: "cancelled",
      updatedAt: "2026-08-04T08:00:00.000Z",
    }),
  );
  const cancelledException = cancelled.lessonExceptions.find(
    (exception) => exception.id === "robotics-aug-3-exception",
  );
  assert.equal(cancelledException.originalDate, originalDate);
  assert.deepEqual(cancelledException.original, {
    startTime: "10:00",
    endTime: "11:00",
    branchId: "kurskaya",
    roomId: "robotics-junior-room",
    teacherIds: ["teacher-1"],
  });
  assert.deepEqual(cancelledException.effective, {
    date: originalDate,
    startTime: "10:00",
    endTime: "11:00",
    branchId: "kurskaya",
    roomId: "robotics-junior-room",
    teacherIds: ["teacher-1"],
    capacity: 8,
    trialPolicy: { mode: "free" },
    allowSingleVisits: false,
  });
  assert.equal(
    materializeSchedule(cancelled, {
      startsOn: originalDate,
      endsOn: originalDate,
    })[0]?.status,
    "cancelled",
  );

  const moved = savedWorkspace(
    upsertBookingLessonException(cancelled, {
      id: "robotics-aug-3-exception",
      recurrenceRuleId,
      originalDate,
      kind: "override",
      override: {
        date: "2026-08-11",
        startTime: "13:00",
        endTime: "14:00",
      },
    }),
    2,
  );
  assert.equal(
    materializeSchedule(moved, {
      startsOn: originalDate,
      endsOn: originalDate,
    }).some(
      (occurrence) =>
        occurrence.recurrenceRuleId === recurrenceRuleId &&
        occurrence.originalDate === originalDate,
    ),
    false,
  );
  const movedOccurrences = materializeSchedule(moved, {
    startsOn: "2026-08-10",
    endsOn: "2026-08-16",
  });
  const movedOccurrence = movedOccurrences.find(
    (occurrence) => occurrence.originalDate === originalDate,
  );
  assert.equal(movedOccurrence?.date, "2026-08-11");
  assert.equal(movedOccurrence?.startTime, "13:00");
  assert.equal(movedOccurrence?.status, "moved");
  assert.equal(
    movedOccurrences.find(
      (occurrence) => occurrence.originalDate === "2026-08-10",
    )?.startTime,
    "10:00",
  );

  const restored = savedWorkspace(
    restoreBookingLessonToSeries(moved, recurrenceRuleId, originalDate),
    3,
  );
  assert.equal(
    restored.lessonExceptions.some(
      (exception) =>
        exception.recurrenceRuleId === recurrenceRuleId &&
        exception.originalDate === originalDate,
    ),
    false,
  );
  assert.equal(
    materializeSchedule(restored, {
      startsOn: originalDate,
      endsOn: originalDate,
    })[0]?.status,
    "scheduled",
  );
});

test("cancelling a moved lesson freezes its latest effective slot and settings", () => {
  const recurrenceRuleId = "robotics-junior-weekly";
  const originalDate = "2026-08-03";
  const targetRoom = DEMO_BOOKING_WORKSPACE.rooms.find(
    (room) => room.branchId === "akademicheskaya",
  );
  const targetTeacher = DEMO_BOOKING_WORKSPACE.teachers.find(
    (teacher) => teacher.id !== "teacher-1",
  );
  assert.ok(targetRoom);
  assert.ok(targetTeacher);

  const moved = savedWorkspace(
    upsertBookingLessonException(DEMO_BOOKING_WORKSPACE, {
      id: "robotics-aug-3-moved-cancelled",
      recurrenceRuleId,
      originalDate,
      kind: "override",
      override: {
        date: "2026-08-11",
        startTime: "07:00",
        endTime: "08:00",
        branchId: "akademicheskaya",
        roomId: targetRoom.id,
        teacherIds: [targetTeacher.id],
        capacity: 5,
        trialPolicy: {
          mode: "paid",
          price: { amountMinor: 75_000, currency: "RUB" },
        },
      },
    }),
  );
  const cancelled = savedWorkspace(
    upsertBookingLessonException(moved, {
      id: "robotics-aug-3-moved-cancelled",
      recurrenceRuleId,
      originalDate,
      kind: "cancelled",
      updatedAt: "2026-08-04T08:00:00.000Z",
    }),
    2,
  );
  const exception = cancelled.lessonExceptions.find(
    (candidate) => candidate.id === "robotics-aug-3-moved-cancelled",
  );
  assert.equal(exception.kind, "cancelled");
  assert.deepEqual(exception.effective, {
    date: "2026-08-11",
    startTime: "07:00",
    endTime: "08:00",
    branchId: "akademicheskaya",
    roomId: targetRoom.id,
    teacherIds: [targetTeacher.id],
    capacity: 5,
    trialPolicy: {
      mode: "paid",
      price: { amountMinor: 75_000, currency: "RUB" },
    },
    allowSingleVisits: false,
  });

  const originalRange = materializeSchedule(cancelled, {
    startsOn: originalDate,
    endsOn: originalDate,
  });
  assert.equal(
    originalRange.some(
      (occurrence) =>
        occurrence.recurrenceRuleId === recurrenceRuleId &&
        occurrence.originalDate === originalDate,
    ),
    false,
  );

  const targetRange = materializeSchedule(cancelled, {
    startsOn: "2026-08-10",
    endsOn: "2026-08-16",
  });
  const cancelledOccurrence = targetRange.find(
    (occurrence) => occurrence.originalDate === originalDate,
  );
  assert.equal(cancelledOccurrence?.status, "cancelled");
  assert.equal(cancelledOccurrence?.date, "2026-08-11");
  assert.equal(cancelledOccurrence?.startTime, "07:00");
  assert.equal(cancelledOccurrence?.endTime, "08:00");
  assert.equal(cancelledOccurrence?.branchId, "akademicheskaya");
  assert.equal(cancelledOccurrence?.roomId, targetRoom.id);
  assert.deepEqual(cancelledOccurrence?.teacherIds, [targetTeacher.id]);
  assert.equal(cancelledOccurrence?.capacity, 5);
  assert.deepEqual(cancelledOccurrence?.trialPolicy, {
    mode: "paid",
    price: { amountMinor: 75_000, currency: "RUB" },
  });
  const adjacentOccurrence = targetRange.find(
    (occurrence) => occurrence.originalDate === "2026-08-10",
  );
  assert.equal(adjacentOccurrence?.status, "scheduled");
  assert.equal(adjacentOccurrence?.date, "2026-08-10");
  assert.equal(adjacentOccurrence?.startTime, "10:00");
  assert.equal(adjacentOccurrence?.capacity, 8);
  assert.deepEqual(adjacentOccurrence?.trialPolicy, { mode: "free" });

  const restored = savedWorkspace(
    restoreBookingLessonToSeries(cancelled, recurrenceRuleId, originalDate),
    3,
  );
  const restoredOccurrence = materializeSchedule(restored, {
    startsOn: originalDate,
    endsOn: originalDate,
  }).find((occurrence) => occurrence.originalDate === originalDate);
  assert.equal(restoredOccurrence?.status, "scheduled");
  assert.equal(restoredOccurrence?.date, originalDate);
  assert.equal(restoredOccurrence?.startTime, "10:00");
  assert.equal(restoredOccurrence?.capacity, 8);
  assert.deepEqual(restoredOccurrence?.trialPolicy, { mode: "free" });
});

test("exact lesson cancellation terminates only active bookings and restore never revives them", () => {
  const lessonRef = {
    recurrenceRuleId: "public-limited-weekly",
    originalDate: "2026-08-10",
  };
  const neighborRef = { ...lessonRef, originalDate: "2026-08-17" };
  const workspace = parseBookingWorkspace({
    ...DEMO_BOOKING_WORKSPACE,
    ...clientCollections(),
    bookings: [
      publicBooking({
        id: "a",
        lessonRef,
        status: "pending_confirmation",
        transferRequest: {
          status: "pending",
          requestedAt: "2026-08-04T08:30:00.000Z",
        },
      }),
      publicBooking({ id: "c", lessonRef, status: "confirmed" }),
      publicBooking({ id: "e", lessonRef, status: "cancelled_by_parent" }),
      publicBooking({
        id: "7",
        lessonRef: neighborRef,
        status: "pending_confirmation",
      }),
    ],
  });

  const moved = savedWorkspace(
    upsertBookingLessonException(workspace, {
      id: "limited-exception",
      recurrenceRuleId: lessonRef.recurrenceRuleId,
      originalDate: lessonRef.originalDate,
      kind: "override",
      override: { startTime: "15:30", endTime: "16:30" },
    }),
  );
  assert.equal(moved.bookings[0].status, "pending_confirmation");

  const cancelled = savedWorkspace(
    upsertBookingLessonException(moved, {
      id: "limited-exception",
      recurrenceRuleId: lessonRef.recurrenceRuleId,
      originalDate: lessonRef.originalDate,
      kind: "cancelled",
      updatedAt: "2026-08-04T10:00:00.000Z",
    }),
    2,
  );
  assert.deepEqual(
    cancelled.bookings.map(({ status }) => status),
    [
      "cancelled_by_center",
      "cancelled_by_center",
      "cancelled_by_parent",
      "pending_confirmation",
    ],
  );
  assert.equal(cancelled.bookings[0].transferRequest, null);
  assert.equal(cancelled.bookings[0].updatedAt, "2026-08-04T10:00:00.000Z");
  assert.equal(cancelled.bookings[2].updatedAt, "2026-08-04T08:00:00.000Z");

  const restored = savedWorkspace(
    restoreBookingLessonToSeries(
      cancelled,
      lessonRef.recurrenceRuleId,
      lessonRef.originalDate,
    ),
    3,
  );
  assert.equal(restored.bookings[0].status, "cancelled_by_center");
  assert.equal(restored.bookings[1].status, "cancelled_by_center");
  assert.equal(restored.bookings[3].status, "pending_confirmation");
});

test("entity mutators reject unknown ids and cross-organization writes", () => {
  assert.throws(
    () =>
      setBookingTeacherStatus(DEMO_BOOKING_WORKSPACE, "missing", "archived"),
    BookingEntityMutationError,
  );
  assert.throws(
    () =>
      upsertBookingTeacher(DEMO_BOOKING_WORKSPACE, {
        id: "teacher-other",
        organizationId: "another-center",
        displayName: "Чужой преподаватель",
        status: "active",
      }),
    BookingEntityMutationError,
  );
  assert.throws(
    () =>
      upsertBookingRoom(DEMO_BOOKING_WORKSPACE, {
        id: "room-other",
        organizationId: "airhop",
        branchId: "missing-branch",
        name: "Чужой кабинет",
        status: "active",
      }),
    BookingEntityMutationError,
  );
  assert.throws(
    () =>
      restoreBookingLessonToSeries(
        DEMO_BOOKING_WORKSPACE,
        "missing-rule",
        "2026-08-03",
      ),
    BookingEntityMutationError,
  );
});

test("client mutators enforce organization and family ownership", () => {
  const workspace = parseBookingWorkspace({
    ...DEMO_BOOKING_WORKSPACE,
    ...clientCollections(),
  });
  const renamed = savedWorkspace(
    upsertBookingFamily(workspace, {
      ...workspace.families[0],
      displayName: "Семья Соколовых",
      updatedAt: "2026-08-05T10:00:00.000Z",
    }),
  );
  assert.equal(renamed.families[0].displayName, "Семья Соколовых");

  const representative = savedWorkspace(
    upsertBookingRepresentative(renamed, {
      ...renamed.representatives[0],
      displayName: "Мария Соколова",
      updatedAt: "2026-08-05T10:00:00.000Z",
    }),
    2,
  );
  assert.equal(representative.representatives[0].displayName, "Мария Соколова");

  const child = savedWorkspace(
    upsertBookingChild(representative, {
      ...representative.children[0],
      note: "Любит робототехнику",
      updatedAt: "2026-08-05T10:00:00.000Z",
    }),
    3,
  );
  assert.equal(child.children[0].note, "Любит робототехнику");

  assert.throws(
    () =>
      upsertBookingFamily(workspace, {
        ...workspace.families[0],
        organizationId: "other-center",
      }),
    BookingEntityMutationError,
  );
  assert.throws(
    () =>
      upsertBookingRepresentative(workspace, {
        ...workspace.representatives[0],
        familyId: "missing-family",
      }),
    BookingEntityMutationError,
  );
  assert.throws(
    () =>
      upsertBookingChild(workspace, {
        ...workspace.children[0],
        familyId: "missing-family",
      }),
    BookingEntityMutationError,
  );
});

test("a family primary representative must belong to that family", () => {
  const collections = clientCollections();
  const workspace = parseBookingWorkspace({
    ...DEMO_BOOKING_WORKSPACE,
    ...collections,
    families: [
      ...collections.families,
      {
        ...collections.families[0],
        id: "family-second",
        displayName: "Семья Вторая",
        primaryRepresentativeId: "representative-second",
      },
    ],
    representatives: [
      ...collections.representatives,
      {
        ...collections.representatives[0],
        id: "representative-second",
        familyId: "family-second",
        phoneNormalized: "+79997654321",
        phoneDisplay: "+7 999 765-43-21",
      },
    ],
  });

  assert.throws(
    () =>
      upsertBookingFamily(workspace, {
        ...workspace.families[0],
        primaryRepresentativeId: "representative-second",
      }),
    /does not belong to family family-test/,
  );
});

test("archiving a family changes only family status", () => {
  const workspace = parseBookingWorkspace({
    ...DEMO_BOOKING_WORKSPACE,
    ...clientCollections(),
  });
  const draft = setBookingFamilyStatus(
    workspace,
    "family-test",
    "archived",
    "2026-08-05T12:00:00.000Z",
  );

  assert.equal(draft.families[0].status, "archived");
  assert.equal(draft.families[0].updatedAt, "2026-08-05T12:00:00.000Z");
  assert.equal(draft.representatives[0].status, "active");
  assert.equal(draft.children[0].status, "active");
});

test("staff confirmation and rejection preserve applicant snapshots and validate transitions", () => {
  const lessonRef = {
    recurrenceRuleId: "public-limited-weekly",
    originalDate: "2026-08-10",
  };
  const original = publicBooking({
    id: "a",
    lessonRef,
    status: "pending_confirmation",
    transferRequest: {
      status: "pending",
      requestedAt: "2026-08-04T08:30:00.000Z",
    },
  });
  const workspace = parseBookingWorkspace({
    ...DEMO_BOOKING_WORKSPACE,
    ...clientCollections(),
    bookings: [original],
  });
  const applicantSnapshot = structuredClone(workspace.bookings[0].applicant);

  const confirmed = savedWorkspace(
    setStaffBookingStatus(
      workspace,
      original.id,
      "confirmed",
      "2026-08-05T12:00:00.000Z",
    ),
  );
  assert.equal(confirmed.bookings[0].status, "confirmed");
  assert.deepEqual(confirmed.bookings[0].applicant, applicantSnapshot);
  assert.deepEqual(
    confirmed.bookings[0].transferRequest,
    original.transferRequest,
  );

  assert.throws(
    () =>
      setStaffBookingStatus(
        confirmed,
        original.id,
        "rejected",
        "2026-08-05T13:00:00.000Z",
      ),
    BookingEntityMutationError,
  );

  const rejected = savedWorkspace(
    setStaffBookingStatus(
      workspace,
      original.id,
      "rejected",
      "2026-08-05T12:00:00.000Z",
    ),
    2,
  );
  assert.equal(rejected.bookings[0].status, "rejected");
  assert.equal(rejected.bookings[0].transferRequest, null);
  assert.deepEqual(rejected.bookings[0].applicant, applicantSnapshot);
  assert.throws(
    () =>
      setStaffBookingStatus(
        workspace,
        "missing-booking",
        "confirmed",
        "2026-08-05T12:00:00.000Z",
      ),
    BookingEntityMutationError,
  );
});
