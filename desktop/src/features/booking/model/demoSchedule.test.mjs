import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_BOOKING_WORKSPACE,
  DEMO_BRANCHES,
  getAvailablePlaces,
  getBookingBranches,
  getDemoWeek,
  getIsoDateInTimeZone,
  getWorkspaceWeek,
} from "./demoSchedule.ts";
import { parseBookingWorkspace } from "./bookingCore.ts";

const TEST_CLIENT_RECORDS = {
  families: [
    {
      id: "test-family",
      organizationId: "airhop",
      displayName: "Семья Льва",
      primaryRepresentativeId: "test-representative",
      status: "active",
      createdAt: "2026-08-04T09:00:00.000Z",
      updatedAt: "2026-08-04T09:00:00.000Z",
    },
  ],
  representatives: [
    {
      id: "test-representative",
      organizationId: "airhop",
      familyId: "test-family",
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
      id: "test-child",
      organizationId: "airhop",
      familyId: "test-family",
      displayName: "Лев",
      birthDate: "2020-08-10",
      status: "active",
      createdAt: "2026-08-04T09:00:00.000Z",
      updatedAt: "2026-08-04T09:00:00.000Z",
    },
  ],
};

test("AirHop demo covers the schedule states used by the first UI slice", () => {
  const { lessons } = getDemoWeek();

  assert.equal(DEMO_BRANCHES.length, 2);
  assert.ok(lessons.length >= 12);
  assert.ok(lessons.some((lesson) => lesson.capacity === undefined));
  assert.ok(lessons.some((lesson) => lesson.trial.mode === "free"));
  assert.ok(lessons.some((lesson) => lesson.trial.mode === "paid"));
  assert.ok(lessons.some((lesson) => !lesson.teachers?.length));
  assert.ok(lessons.some((lesson) => lesson.teachers?.length === 1));
  assert.ok(lessons.some((lesson) => (lesson.teachers?.length ?? 0) > 1));
  assert.ok(lessons.some((lesson) => !lesson.room));
  assert.ok(lessons.some((lesson) => lesson.status === "moved"));
  assert.ok(lessons.some((lesson) => lesson.status === "cancelled"));
});

test("AirHop demo provides reusable active tariffs without fake payments", () => {
  assert.equal(DEMO_BOOKING_WORKSPACE.schemaVersion, 8);
  assert.deepEqual(
    DEMO_BOOKING_WORKSPACE.tariffs.map((tariff) => ({
      name: tariff.name,
      weeklyScheduleLimit: tariff.weeklyScheduleLimit,
      status: tariff.status,
    })),
    [
      {
        name: "1 раз в неделю",
        weeklyScheduleLimit: 1,
        status: "active",
      },
      {
        name: "2 раза в неделю",
        weeklyScheduleLimit: 2,
        status: "active",
      },
      {
        name: "3 раза в неделю",
        weeklyScheduleLimit: 3,
        status: "active",
      },
    ],
  );
  assert.deepEqual(DEMO_BOOKING_WORKSPACE.paymentExpectations, []);
});

test("AirHop schedule counts one occupied place per child", () => {
  function booking(id, recurrenceRuleId, originalDate, sequence) {
    return {
      id,
      organizationId: "airhop",
      familyId: "test-family",
      representativeId: "test-representative",
      childId: "test-child",
      lessonRef: { recurrenceRuleId, originalDate },
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
      status: "pending_confirmation",
      transferRequest: null,
      managementTokenDigest: sequence.toString(16).padStart(64, "0"),
      idempotencyKeyDigest: (sequence + 100).toString(16).padStart(64, "0"),
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

  const workspace = parseBookingWorkspace({
    ...DEMO_BOOKING_WORKSPACE,
    ...TEST_CLIENT_RECORDS,
    bookings: [
      ...Array.from({ length: 7 }, (_, index) =>
        booking(
          `robotics-${index}`,
          "robotics-junior-weekly",
          "2026-08-03",
          index + 1,
        ),
      ),
      booking("limited", "public-limited-weekly", "2026-08-10", 8),
    ],
  });
  const firstWeek = getWorkspaceWeek(workspace, 0, "2026-08-04");
  const nextWeek = getWorkspaceWeek(workspace, 1, "2026-08-04");

  assert.equal(
    getAvailablePlaces(
      firstWeek.lessons.find(
        (lesson) => lesson.recurrenceRuleId === "robotics-junior-weekly",
      ),
    ),
    7,
  );
  assert.equal(
    getAvailablePlaces(
      nextWeek.lessons.find(
        (lesson) => lesson.recurrenceRuleId === "public-limited-weekly",
      ),
    ),
    0,
  );
});

test("AirHop demo moves the deterministic pattern by complete weeks", () => {
  const current = getDemoWeek(0);
  const following = getDemoWeek(1);

  assert.equal(current.startDate, "2026-08-03");
  assert.equal(following.startDate, "2026-08-10");
  assert.equal(current.lessons[0].groupName, following.lessons[0].groupName);
  assert.notEqual(current.lessons[0].id, following.lessons[0].id);
});

test("AirHop demo applies lesson exceptions only to their original occurrence", () => {
  const current = getDemoWeek(0);
  const following = getDemoWeek(1);

  const currentEnglish = current.lessons.find(
    (lesson) => lesson.groupName === "English Play",
  );
  const followingEnglish = following.lessons.find(
    (lesson) => lesson.groupName === "English Play",
  );
  const currentTheatre = current.lessons.find(
    (lesson) => lesson.groupName === "Театральная студия",
  );
  const followingTheatre = following.lessons.find(
    (lesson) => lesson.groupName === "Театральная студия",
  );

  assert.equal(currentEnglish?.status, "moved");
  assert.equal(currentEnglish?.startTime, "11:00");
  assert.deepEqual(currentEnglish?.movedFrom, {
    date: "2026-08-05",
    startTime: "10:00",
    endTime: "11:00",
  });
  assert.equal(followingEnglish?.status, "scheduled");
  assert.equal(currentTheatre?.status, "cancelled");
  assert.equal(followingTheatre?.status, "scheduled");
});

test("AirHop schedule anchors Today to the organization time zone", () => {
  const instant = new Date("2026-08-02T22:30:00Z");
  assert.equal(getIsoDateInTimeZone("Europe/Moscow", instant), "2026-08-03");
  assert.equal(getIsoDateInTimeZone("America/New_York", instant), "2026-08-02");

  const week = getWorkspaceWeek(DEMO_BOOKING_WORKSPACE, 0, "2026-08-04");
  assert.equal(week.startDate, "2026-08-03");
  assert.equal(week.endDate, "2026-08-09");
});

test("AirHop schedule keeps month-precise age limits", () => {
  const draft = structuredClone(DEMO_BOOKING_WORKSPACE);
  const group = draft.groups.find(
    (candidate) => candidate.id === "robotics-junior",
  );
  group.minAgeMonths = 71;
  delete group.maxAgeMonths;
  const workspace = parseBookingWorkspace(draft);
  const week = getWorkspaceWeek(workspace, 0, "2026-08-04");
  const lesson = week.lessons.find(
    (candidate) => candidate.groupName === "Робототехника Junior",
  );

  assert.equal(lesson?.ageLabel, "от 5 лет 11 месяцев");
});

test("archived branches stay in history but leave active schedule filters", () => {
  const draft = structuredClone(DEMO_BOOKING_WORKSPACE);
  const branch = draft.branches[0];
  branch.status = "archived";
  const workspace = parseBookingWorkspace(draft);

  assert.ok(!getBookingBranches(workspace).some(({ id }) => id === branch.id));
  const lessons = getWorkspaceWeek(workspace, 0, "2026-08-04").lessons.filter(
    ({ branchId }) => branchId === branch.id,
  );
  assert.ok(lessons.length > 0);
  assert.ok(lessons.every(({ branchStatus }) => branchStatus === "archived"));
});
