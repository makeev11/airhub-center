import assert from "node:assert/strict";
import test from "node:test";

import {
  BookingWorkspaceValidationError,
  parseBookingWorkspace,
} from "./bookingCore.ts";
import { materializeSchedule } from "./materializeSchedule.ts";
import {
  BookingRevisionConflictError,
  BrowserPreviewBookingRepository,
  InMemoryBookingRepository,
} from "../data/bookingRepository.ts";

function makeWorkspace() {
  return {
    schemaVersion: 1,
    revision: 0,
    organization: {
      id: "airhop",
      name: "AirHop Demo",
      locale: "ru-RU",
      timeZone: "Europe/Moscow",
      defaultTrialPolicy: { mode: "free" },
      trackAttendanceByDefault: true,
    },
    branches: [
      {
        id: "kurskaya",
        organizationId: "airhop",
        name: "Курская",
        address: "ул. Земляной Вал, 27",
        workingHours: {
          tuesday: [{ startTime: "09:00", endTime: "21:00" }],
          thursday: [{ startTime: "09:00", endTime: "21:00" }],
        },
      },
      {
        id: "akademicheskaya",
        organizationId: "airhop",
        name: "Академическая",
        address: "Профсоюзная ул., 17",
        workingHours: {
          friday: [{ startTime: "10:00", endTime: "22:00" }],
        },
      },
    ],
    rooms: [
      {
        id: "kurskaya-lab",
        organizationId: "airhop",
        branchId: "kurskaya",
        name: "Лаборатория",
      },
      {
        id: "akademicheskaya-hall",
        organizationId: "airhop",
        branchId: "akademicheskaya",
        name: "Зал",
      },
    ],
    teachers: [
      {
        id: "anna",
        organizationId: "airhop",
        displayName: "Анна Орлова",
      },
      {
        id: "elena",
        organizationId: "airhop",
        displayName: "Елена Смирнова",
      },
    ],
    groups: [
      {
        id: "robotics",
        organizationId: "airhop",
        branchId: "kurskaya",
        name: "Робототехника Junior",
        roomId: "kurskaya-lab",
        teacherIds: ["anna"],
        minAgeMonths: 60,
        maxAgeMonths: 84,
        capacity: 10,
        status: "active",
      },
    ],
    recurrenceRules: [
      {
        id: "robotics-autumn",
        organizationId: "airhop",
        groupId: "robotics",
        startsOn: "2026-08-10",
        endsOn: "2026-08-21",
        weekdays: ["tuesday", "thursday"],
        startTime: "10:00",
        endTime: "11:00",
      },
    ],
    lessonExceptions: [
      {
        id: "cancel-aug-11",
        organizationId: "airhop",
        recurrenceRuleId: "robotics-autumn",
        originalDate: "2026-08-11",
        kind: "cancelled",
        reason: "Праздник",
      },
      {
        id: "move-aug-13",
        organizationId: "airhop",
        recurrenceRuleId: "robotics-autumn",
        originalDate: "2026-08-13",
        kind: "override",
        override: {
          date: "2026-08-14",
          startTime: "12:00",
          endTime: "13:00",
          branchId: "akademicheskaya",
          roomId: "akademicheskaya-hall",
          teacherIds: ["elena"],
          capacity: null,
          trialPolicy: {
            mode: "paid",
            price: { amountMinor: 90_000, currency: "RUB" },
          },
        },
      },
      {
        id: "teacher-aug-18",
        organizationId: "airhop",
        recurrenceRuleId: "robotics-autumn",
        originalDate: "2026-08-18",
        kind: "override",
        override: { teacherIds: ["elena"] },
      },
    ],
  };
}

function makeLegacyV5WorkspaceWithBooking() {
  const legacy = structuredClone(parseBookingWorkspace(makeWorkspace()));
  legacy.schemaVersion = 5;
  delete legacy.families;
  delete legacy.representatives;
  delete legacy.children;
  delete legacy.duplicateCandidates;
  legacy.bookings = [
    {
      id: "legacy-booking-1",
      organizationId: "airhop",
      lessonRef: {
        recurrenceRuleId: "robotics-autumn",
        originalDate: "2026-08-11",
      },
      applicant: {
        parentName: "Ирина Соколова",
        phoneNormalized: "+79991234567",
        phoneDisplay: "+7 999 123-45-67",
        childName: "Маша Соколова",
        childBirthDate: "2020-06-15",
        consentVersion: "privacy-v1",
        consentAcceptedAt: "2026-08-05T09:00:00.000Z",
        preferredContactChannel: "telegram",
      },
      status: "pending_confirmation",
      transferRequest: null,
      managementTokenDigest: "a".repeat(64),
      idempotencyKeyDigest: "b".repeat(64),
      source: {
        surface: "embedded",
        attributionBranchId: "kurskaya",
        purpose: "trial",
      },
      createdAt: "2026-08-05T09:00:00.000Z",
      updatedAt: "2026-08-05T09:00:00.000Z",
    },
  ];
  return legacy;
}

function makeConfiguredV8Workspace() {
  const workspace = structuredClone(parseBookingWorkspace(makeWorkspace()));
  const now = "2026-08-06T09:00:00.000Z";
  workspace.schemaVersion = 8;
  workspace.organization.paymentDayOfMonth = 5;
  workspace.families = [
    {
      id: "family-petrova",
      organizationId: "airhop",
      displayName: "Семья Петровых",
      primaryRepresentativeId: "representative-petrova",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  ];
  workspace.representatives = [
    {
      id: "representative-petrova",
      organizationId: "airhop",
      familyId: "family-petrova",
      displayName: "Ирина Петрова",
      phoneNormalized: "+79991234567",
      phoneDisplay: "+7 999 123-45-67",
      preferredContactChannel: "telegram",
      messengerAccounts: [],
      consentVersion: "privacy-v1",
      consentAcceptedAt: now,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  ];
  workspace.children = [
    {
      id: "child-masha",
      organizationId: "airhop",
      familyId: "family-petrova",
      displayName: "Маша Петрова",
      birthDate: "2020-06-15",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  ];
  workspace.tariffs = [
    {
      id: "tariff-twice",
      organizationId: "airhop",
      name: "2 раза в неделю",
      description: "Два регулярных дня",
      priceMinor: 600_000,
      currency: "RUB",
      weeklyScheduleLimit: 2,
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
  ];
  workspace.enrollments = [
    {
      id: "enrollment-robotics",
      organizationId: "airhop",
      familyId: "family-petrova",
      childId: "child-masha",
      groupId: "robotics",
      startDate: "2026-08-06",
      status: "active",
      source: "staff_ui",
      createdBy: "admin@example.test",
      assignmentState: "configured",
      tariffId: "tariff-twice",
      weeklyScheduleSelections: [
        { recurrenceRuleId: "robotics-autumn", weekday: "tuesday" },
      ],
      createdAt: now,
      updatedAt: now,
    },
  ];
  workspace.paymentExpectations = [
    {
      id: "payment-enrollment-robotics-first",
      organizationId: "airhop",
      familyId: "family-petrova",
      childId: "child-masha",
      enrollmentId: "enrollment-robotics",
      tariffId: "tariff-twice",
      tariffNameSnapshot: "2 раза в неделю",
      amountMinor: 600_000,
      currency: "RUB",
      dueDate: "2026-08-06",
      status: "expected",
      createdAt: now,
      updatedAt: now,
    },
  ];
  return workspace;
}

test("Booking Core v8 validates tariffs, weekly slots, and payments", () => {
  const parsed = parseBookingWorkspace(makeConfiguredV8Workspace());

  assert.equal(parsed.schemaVersion, 8);
  assert.equal(parsed.organization.paymentDayOfMonth, 5);
  assert.equal(parsed.tariffs[0].currency, "RUB");
  assert.equal(parsed.enrollments[0].assignmentState, "configured");
  assert.deepEqual(parsed.enrollments[0].weeklyScheduleSelections, [
    { recurrenceRuleId: "robotics-autumn", weekday: "tuesday" },
  ]);
  assert.equal(parsed.paymentExpectations[0].amountMinor, 600_000);
});

test("configured enrollment requires a tariff and at least one weekly slot", () => {
  const missingTariff = makeConfiguredV8Workspace();
  delete missingTariff.enrollments[0].tariffId;
  assert.throws(() => parseBookingWorkspace(missingTariff));

  const missingSlots = makeConfiguredV8Workspace();
  missingSlots.enrollments[0].weeklyScheduleSelections = [];
  assert.throws(() => parseBookingWorkspace(missingSlots));
});

test("v7 enrollment migrates to needs_assignment without inventing money", () => {
  const legacy = structuredClone(parseBookingWorkspace(makeWorkspace()));
  legacy.schemaVersion = 7;
  delete legacy.organization.paymentDayOfMonth;
  delete legacy.tariffs;
  delete legacy.paymentExpectations;
  legacy.families = makeConfiguredV8Workspace().families;
  legacy.representatives = makeConfiguredV8Workspace().representatives;
  legacy.children = makeConfiguredV8Workspace().children;
  legacy.enrollments = [
    {
      id: "legacy-enrollment",
      organizationId: "airhop",
      familyId: "family-petrova",
      childId: "child-masha",
      groupId: "robotics",
      startDate: "2026-08-06",
      status: "active",
      source: "import",
      createdBy: "legacy-import",
      createdAt: "2026-08-06T09:00:00.000Z",
      updatedAt: "2026-08-06T09:00:00.000Z",
    },
  ];

  const migrated = parseBookingWorkspace(legacy);

  assert.equal(migrated.schemaVersion, 8);
  assert.equal(migrated.organization.paymentDayOfMonth, 5);
  assert.equal(migrated.enrollments[0].assignmentState, "needs_assignment");
  assert.deepEqual(migrated.enrollments[0].weeklyScheduleSelections, []);
  assert.deepEqual(migrated.tariffs, []);
  assert.deepEqual(migrated.paymentExpectations, []);
});

test("Booking Core validates entity references", () => {
  const valid = parseBookingWorkspace(makeWorkspace());
  assert.equal(valid.organization.id, "airhop");
  assert.equal(valid.schemaVersion, 8);
  assert.deepEqual(valid.bookings, []);
  assert.deepEqual(valid.tariffs, []);
  assert.deepEqual(valid.enrollments, []);
  assert.deepEqual(valid.paymentExpectations, []);
  assert.deepEqual(valid.intakeRequests, []);
  assert.deepEqual(valid.pendingActions, []);
  assert.deepEqual(valid.attendanceRecords, []);
  assert.equal(valid.organization.allowSingleVisitsByDefault, false);
  assert.equal(valid.organization.paymentDayOfMonth, 5);
  assert.deepEqual(valid.organization.existingStudentsOnboarding, {
    status: "not_started",
  });
  assert.deepEqual(valid.families, []);
  assert.deepEqual(valid.representatives, []);
  assert.deepEqual(valid.children, []);
  assert.deepEqual(valid.duplicateCandidates, []);
  assert.ok(valid.branches.every((branch) => branch.status === "active"));
  assert.ok(valid.rooms.every((room) => room.status === "active"));
  assert.ok(valid.teachers.every((teacher) => teacher.status === "active"));
  assert.ok(valid.recurrenceRules.every((rule) => rule.status === "active"));
  assert.equal(valid.lessonExceptions[0].original.startTime, "10:00");

  const invalid = makeWorkspace();
  invalid.groups[0].roomId = "missing-room";
  assert.throws(
    () => parseBookingWorkspace(invalid),
    BookingWorkspaceValidationError,
  );

  const invalidException = makeWorkspace();
  invalidException.lessonExceptions[0].originalDate = "2026-08-12";
  assert.throws(
    () => parseBookingWorkspace(invalidException),
    BookingWorkspaceValidationError,
  );

  const invalidTimeZone = makeWorkspace();
  invalidTimeZone.organization.timeZone = "Mars/Olympus";
  assert.throws(
    () => parseBookingWorkspace(invalidTimeZone),
    /Invalid IANA time zone/,
  );

  const invalidLocale = makeWorkspace();
  invalidLocale.organization.locale = "not_a_locale";
  assert.throws(() => parseBookingWorkspace(invalidLocale), /Invalid locale/);

  const invalidCurrency = makeWorkspace();
  invalidCurrency.organization.defaultTrialPolicy = {
    mode: "paid",
    price: { amountMinor: 1_000, currency: "BAD" },
  };
  assert.throws(
    () => parseBookingWorkspace(invalidCurrency),
    /Unknown currency/,
  );
});

test("Booking Core migrates persisted v2 entity statuses and lesson originals", () => {
  const legacy = structuredClone(parseBookingWorkspace(makeWorkspace()));
  legacy.schemaVersion = 2;
  for (const room of legacy.rooms) delete room.status;
  for (const teacher of legacy.teachers) delete teacher.status;
  for (const rule of legacy.recurrenceRules) delete rule.status;
  for (const exception of legacy.lessonExceptions) delete exception.original;

  const migrated = parseBookingWorkspace(legacy);
  assert.equal(migrated.schemaVersion, 8);
  assert.deepEqual(migrated.bookings, []);
  assert.ok(migrated.rooms.every((room) => room.status === "active"));
  assert.ok(migrated.teachers.every((teacher) => teacher.status === "active"));
  assert.ok(migrated.recurrenceRules.every((rule) => rule.status === "active"));
  assert.deepEqual(migrated.lessonExceptions[0].original, {
    startTime: "10:00",
    endTime: "11:00",
    branchId: "kurskaya",
    roomId: "kurskaya-lab",
    teacherIds: ["anna"],
  });
});

test("Booking Core migrates persisted v3 rooms and lesson snapshots", () => {
  const legacy = structuredClone(parseBookingWorkspace(makeWorkspace()));
  legacy.schemaVersion = 3;
  for (const room of legacy.rooms) delete room.status;
  for (const exception of legacy.lessonExceptions) delete exception.original;

  const migrated = parseBookingWorkspace(legacy);
  assert.equal(migrated.schemaVersion, 8);
  assert.deepEqual(migrated.bookings, []);
  assert.ok(migrated.rooms.every((room) => room.status === "active"));
  assert.equal(migrated.lessonExceptions[1].original.startTime, "10:00");
  assert.equal(migrated.lessonExceptions[1].originalDate, "2026-08-13");
});

test("Booking Core reads v4 cancelled exceptions without an effective snapshot", () => {
  const legacyV4 = structuredClone(parseBookingWorkspace(makeWorkspace()));
  legacyV4.schemaVersion = 4;
  delete legacyV4.bookings;
  const cancelled = legacyV4.lessonExceptions.find(
    (exception) => exception.kind === "cancelled",
  );
  assert.ok(cancelled);
  delete cancelled.effective;

  const parsed = parseBookingWorkspace(legacyV4);
  assert.equal(parsed.schemaVersion, 8);
  assert.deepEqual(parsed.bookings, []);
  const parsedCancelled = parsed.lessonExceptions.find(
    (exception) => exception.id === cancelled.id,
  );
  assert.equal(parsedCancelled.kind, "cancelled");
  assert.equal(parsedCancelled.effective, undefined);
  const occurrence = materializeSchedule(parsed, {
    startsOn: cancelled.originalDate,
    endsOn: cancelled.originalDate,
  }).find((candidate) => candidate.originalDate === cancelled.originalDate);
  assert.equal(occurrence?.status, "cancelled");
  assert.equal(occurrence?.date, cancelled.originalDate);
  assert.equal(occurrence?.startTime, "10:00");
});

test("Booking Core migrates v4 through v6 without changing schedule entities", () => {
  const current = parseBookingWorkspace(makeWorkspace());
  const legacyV4 = structuredClone(current);
  legacyV4.schemaVersion = 4;
  delete legacyV4.bookings;

  const migrated = parseBookingWorkspace(legacyV4);

  assert.equal(migrated.schemaVersion, 8);
  assert.deepEqual(migrated.bookings, []);
  assert.deepEqual(migrated.organization, current.organization);
  assert.deepEqual(migrated.branches, current.branches);
  assert.deepEqual(migrated.rooms, current.rooms);
  assert.deepEqual(migrated.teachers, current.teachers);
  assert.deepEqual(migrated.groups, current.groups);
  assert.deepEqual(migrated.recurrenceRules, current.recurrenceRules);
  assert.deepEqual(migrated.lessonExceptions, current.lessonExceptions);
});

test("Booking Core migrates v5 applicants into linked families without changing snapshots", () => {
  const legacy = makeLegacyV5WorkspaceWithBooking();
  const originalApplicant = structuredClone(legacy.bookings[0].applicant);

  const migrated = parseBookingWorkspace(legacy);

  assert.equal(migrated.schemaVersion, 8);
  assert.equal(migrated.families.length, 1);
  assert.equal(migrated.representatives.length, 1);
  assert.equal(migrated.children.length, 1);
  assert.deepEqual(migrated.duplicateCandidates, []);
  assert.equal(migrated.families[0].id, "legacy-family-1");
  assert.equal(
    migrated.families[0].primaryRepresentativeId,
    "legacy-representative-1",
  );
  assert.equal(migrated.representatives[0].familyId, "legacy-family-1");
  assert.equal(migrated.children[0].familyId, "legacy-family-1");
  assert.equal(migrated.bookings[0].familyId, "legacy-family-1");
  assert.equal(
    migrated.bookings[0].representativeId,
    "legacy-representative-1",
  );
  assert.equal(migrated.bookings[0].childId, "legacy-child-1");
  assert.deepEqual(migrated.bookings[0].applicant, originalApplicant);
  assert.equal(migrated.bookings[0].visitKind, "trial");
  assert.equal(migrated.bookings[0].createdBy, "public-booking");
  assert.equal(migrated.bookings[0].source.channel, "website");
  assert.equal(migrated.bookings[0].source.workflow, "request");
});

test("Booking Core migrates v6 operations and maps public lesson purpose to a single visit", () => {
  const legacyV6 = structuredClone(
    parseBookingWorkspace(makeLegacyV5WorkspaceWithBooking()),
  );
  legacyV6.schemaVersion = 6;
  delete legacyV6.organization.allowSingleVisitsByDefault;
  delete legacyV6.organization.existingStudentsOnboarding;
  delete legacyV6.enrollments;
  delete legacyV6.intakeRequests;
  delete legacyV6.pendingActions;
  delete legacyV6.attendanceRecords;
  for (const booking of legacyV6.bookings) {
    delete booking.visitKind;
    delete booking.createdBy;
    delete booking.source.channel;
  }
  legacyV6.bookings.push({
    ...structuredClone(legacyV6.bookings[0]),
    id: "legacy-booking-lesson",
    managementTokenDigest: "c".repeat(64),
    idempotencyKeyDigest: "d".repeat(64),
    source: {
      ...legacyV6.bookings[0].source,
      purpose: "lesson",
    },
  });

  const migrated = parseBookingWorkspace(legacyV6);

  assert.equal(migrated.schemaVersion, 8);
  assert.deepEqual(migrated.enrollments, []);
  assert.deepEqual(migrated.intakeRequests, []);
  assert.deepEqual(migrated.pendingActions, []);
  assert.deepEqual(migrated.attendanceRecords, []);
  assert.equal(migrated.organization.allowSingleVisitsByDefault, false);
  assert.deepEqual(migrated.organization.existingStudentsOnboarding, {
    status: "not_started",
  });
  assert.deepEqual(
    migrated.bookings.map(({ visitKind }) => visitKind),
    ["trial", "single"],
  );
  assert.ok(
    migrated.bookings.every(
      (booking) =>
        booking.createdBy === "public-booking" &&
        booking.source.channel === "website" &&
        booking.source.workflow === "request",
    ),
  );
});

test("Booking Core rejects broken family, representative, child, and booking links", () => {
  const workspace = parseBookingWorkspace(makeLegacyV5WorkspaceWithBooking());

  const unknownFamily = structuredClone(workspace);
  unknownFamily.bookings[0].familyId = "missing-family";
  assert.throws(
    () => parseBookingWorkspace(unknownFamily),
    /Unknown family missing-family/,
  );

  const mismatchedPrimaryRepresentative = structuredClone(workspace);
  mismatchedPrimaryRepresentative.families.push({
    ...mismatchedPrimaryRepresentative.families[0],
    id: "family-2",
    primaryRepresentativeId: "legacy-representative-1",
  });
  assert.throws(
    () => parseBookingWorkspace(mismatchedPrimaryRepresentative),
    /does not belong to family family-2/,
  );

  const mismatchedChild = structuredClone(workspace);
  mismatchedChild.children[0].familyId = "family-2";
  assert.throws(
    () => parseBookingWorkspace(mismatchedChild),
    /Unknown family family-2/,
  );

  const unknownChild = structuredClone(workspace);
  unknownChild.bookings[0].childId = "missing-child";
  assert.throws(
    () => parseBookingWorkspace(unknownChild),
    /Unknown child missing-child/,
  );
});

test("Booking Core archives branches without destroying referenced history", () => {
  const workspace = parseBookingWorkspace(makeWorkspace());
  workspace.branches[0].status = "archived";

  const archived = parseBookingWorkspace(workspace);
  assert.equal(archived.branches[0].status, "archived");
  assert.equal(archived.groups[0].branchId, archived.branches[0].id);
  assert.equal(archived.recurrenceRules[0].groupId, archived.groups[0].id);
});

test("Booking Core keeps archived group lessons queryable only in history mode", () => {
  const workspace = parseBookingWorkspace(makeWorkspace());
  workspace.groups[0].status = "archived";

  assert.equal(
    materializeSchedule(workspace, {
      startsOn: "2026-08-10",
      endsOn: "2026-08-21",
    }).length,
    0,
  );
  assert.equal(
    materializeSchedule(
      workspace,
      { startsOn: "2026-08-10", endsOn: "2026-08-21" },
      { includeArchived: true },
    ).length,
    4,
  );
  assert.equal(workspace.lessonExceptions.length, 3);
});

test("Booking Core materializes recurring lessons and concrete exceptions", () => {
  const workspace = parseBookingWorkspace(makeWorkspace());
  const occurrences = materializeSchedule(workspace, {
    startsOn: "2026-08-10",
    endsOn: "2026-08-21",
  });

  assert.equal(occurrences.length, 4);
  assert.deepEqual(
    occurrences.map(({ date, status }) => ({ date, status })),
    [
      { date: "2026-08-11", status: "cancelled" },
      { date: "2026-08-14", status: "moved" },
      { date: "2026-08-18", status: "modified" },
      { date: "2026-08-20", status: "scheduled" },
    ],
  );
  const moved = occurrences[1];
  assert.equal(moved.originalDate, "2026-08-13");
  assert.equal(moved.branchId, "akademicheskaya");
  assert.equal(moved.roomId, "akademicheskaya-hall");
  assert.deepEqual(moved.teacherIds, ["elena"]);
  assert.equal(moved.capacity, undefined);
  assert.equal(moved.trialPolicy.mode, "paid");
});

test("Booking Core includes lessons moved into a narrow schedule range", () => {
  const workspace = parseBookingWorkspace(makeWorkspace());
  const occurrences = materializeSchedule(workspace, {
    startsOn: "2026-08-14",
    endsOn: "2026-08-14",
  });

  assert.equal(occurrences.length, 1);
  assert.equal(occurrences[0].originalDate, "2026-08-13");
  assert.equal(occurrences[0].date, "2026-08-14");
  assert.equal(occurrences[0].status, "moved");

  const originalRange = materializeSchedule(workspace, {
    startsOn: "2026-08-13",
    endsOn: "2026-08-13",
  });
  assert.equal(
    originalRange.some(
      (occurrence) => occurrence.originalDate === "2026-08-13",
    ),
    false,
  );
});

test("Booking repository protects concurrent writes with revisions", async () => {
  const repository = new InMemoryBookingRepository(
    parseBookingWorkspace(makeWorkspace()),
  );
  const first = await repository.load();
  const second = await repository.load();
  const { revision: _firstRevision, ...firstDraft } = first;
  firstDraft.organization.name = "AirHop Updated";
  const saved = await repository.save(firstDraft, first.revision);

  assert.equal(saved.revision, 1);
  assert.equal(saved.organization.name, "AirHop Updated");
  const { revision: _secondRevision, ...secondDraft } = second;
  await assert.rejects(
    repository.save(secondDraft, second.revision),
    BookingRevisionConflictError,
  );
});

test("Browser preview repository persists valid data and recovers malformed data", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const initialWorkspace = parseBookingWorkspace(makeWorkspace());
  const repository = new BrowserPreviewBookingRepository({
    storage,
    storageKey: "airhop-test",
    initialWorkspace,
  });
  const loaded = await repository.load();
  const { revision: _revision, ...draft } = loaded;
  draft.organization.name = "Persisted AirHop";
  await repository.save(draft, loaded.revision);

  assert.equal((await repository.load()).organization.name, "Persisted AirHop");
  values.set("airhop-test", "not json");
  assert.equal((await repository.load()).organization.name, "AirHop Demo");
  assert.equal(values.get("airhop-test.corrupt-backup"), "not json");
  assert.equal(repository.takeNotice(), "corrupt-data-recovered");
});

test("Browser preview repository serializes cross-tab saves with Web Locks", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  let tail = Promise.resolve();
  const lockCoordinator = {
    runExclusive(_name, task) {
      const result = tail.then(task);
      tail = result.then(
        () => undefined,
        () => undefined,
      );
      return result;
    },
  };
  const initialWorkspace = parseBookingWorkspace(makeWorkspace());
  const firstRepository = new BrowserPreviewBookingRepository({
    storage,
    storageKey: "airhop-shared",
    initialWorkspace,
    lockCoordinator,
  });
  const secondRepository = new BrowserPreviewBookingRepository({
    storage,
    storageKey: "airhop-shared",
    initialWorkspace,
    lockCoordinator,
  });
  const first = await firstRepository.load();
  const second = await secondRepository.load();
  const { revision: _firstRevision, ...firstDraft } = first;
  const { revision: _secondRevision, ...secondDraft } = second;
  firstDraft.organization.name = "First tab";
  secondDraft.organization.name = "Second tab";

  const results = await Promise.allSettled([
    firstRepository.save(firstDraft, first.revision),
    secondRepository.save(secondDraft, second.revision),
  ]);

  assert.equal(firstRepository.writeCoordination, "web-locks");
  assert.equal(
    results.filter(({ status }) => status === "fulfilled").length,
    1,
  );
  const rejection = results.find(({ status }) => status === "rejected");
  assert.ok(rejection);
  assert.ok(rejection.reason instanceof BookingRevisionConflictError);
  assert.equal((await firstRepository.load()).organization.name, "First tab");
});

test("Browser preview repository labels lockless and failed-lock saves best effort", async () => {
  const values = new Map();
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  const initialWorkspace = parseBookingWorkspace(makeWorkspace());
  const lockless = new BrowserPreviewBookingRepository({
    storage,
    storageKey: "airhop-lockless",
    initialWorkspace,
  });
  assert.equal(lockless.writeCoordination, "best-effort");

  const failingLock = new BrowserPreviewBookingRepository({
    storage,
    storageKey: "airhop-failed-lock",
    initialWorkspace,
    lockCoordinator: {
      async runExclusive() {
        throw new Error("locks unavailable");
      },
    },
  });
  const loaded = await failingLock.load();
  const { revision: _revision, ...draft } = loaded;
  draft.organization.name = "Fallback save";
  const saved = await failingLock.save(draft, loaded.revision);

  assert.equal(saved.organization.name, "Fallback save");
  assert.equal(failingLock.writeCoordination, "best-effort");
});

test("Browser preview repository surfaces unavailable storage", async () => {
  const initialWorkspace = parseBookingWorkspace(makeWorkspace());
  const repository = new BrowserPreviewBookingRepository({
    storage: {
      getItem: () => {
        throw new Error("storage denied");
      },
      setItem: () => {},
    },
    storageKey: "airhop-test",
    initialWorkspace,
  });

  await assert.rejects(repository.load(), /could not be read/);
});
