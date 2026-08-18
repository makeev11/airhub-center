import assert from "node:assert/strict";
import test from "node:test";

import {
  aggregateBookingFunnelSegments,
  buildBookingFunnelAnalytics,
} from "./bookingFunnelAnalytics.ts";

function booking(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    childId: "child-1",
    visitKind: "trial",
    status: "confirmed",
    lessonRef: {
      recurrenceRuleId: "rule-1",
      originalDate: "2026-08-12",
    },
    source: { channel: "website", workflow: "request" },
    createdAt: "2026-08-03T10:00:00.000Z",
    ...overrides,
  };
}

function workspace() {
  return {
    organization: {
      timeZone: "Europe/Moscow",
      trackAttendanceByDefault: true,
      allowSingleVisitsByDefault: true,
      defaultTrialPolicy: { mode: "free" },
    },
    branches: [
      { id: "branch-1", name: "Центр" },
      { id: "branch-2", name: "Север" },
    ],
    groups: [
      { id: "group-1", branchId: "branch-1", teacherIds: [] },
      { id: "group-2", branchId: "branch-2", teacherIds: [] },
    ],
    recurrenceRules: [
      {
        id: "rule-1",
        groupId: "group-1",
        startsOn: "2026-01-01",
        endsOn: "2026-12-31",
        weekdays: ["wednesday"],
        startTime: "10:00",
        endTime: "11:00",
        status: "active",
      },
      {
        id: "rule-2",
        groupId: "group-2",
        startsOn: "2026-01-01",
        endsOn: "2026-12-31",
        weekdays: ["wednesday"],
        startTime: "12:00",
        endTime: "13:00",
        status: "active",
      },
    ],
    lessonExceptions: [],
    bookings: [
      booking(),
      booking({
        id: crypto.randomUUID(),
        childId: "child-2",
        status: "cancelled_by_center",
        lessonRef: {
          recurrenceRuleId: "rule-2",
          originalDate: "2026-08-12",
        },
        source: { channel: "phone", workflow: "direct" },
      }),
    ],
    attendanceRecords: [
      {
        childId: "child-1",
        lessonRef: {
          recurrenceRuleId: "rule-1",
          originalDate: "2026-08-12",
        },
        status: "present",
      },
    ],
    enrollments: [
      {
        id: "enrollment-1",
        childId: "child-1",
        groupId: "group-1",
        assignmentState: "configured",
        createdAt: "2026-08-13T10:00:00.000Z",
      },
    ],
    paymentExpectations: [
      {
        id: "payment-1",
        enrollmentId: "enrollment-1",
        billingPeriod: "2026-08-01",
        dueDate: "2026-08-15",
        amountMinor: 600000,
        currency: "RUB",
        status: "paid",
        createdAt: "2026-08-13T10:00:00.000Z",
      },
    ],
  };
}

test("booking funnel keeps cohort, source and branch dimensions", () => {
  const report = buildBookingFunnelAnalytics(workspace(), "2026-08-18");
  assert.equal(report.periods.length, 6);
  const august = report.periods.at(-1);
  assert.deepEqual(august.stages, {
    trialBookings: 2,
    confirmedTrials: 2,
    attendedTrials: 1,
    permanentEnrollments: 1,
    firstPaymentsPaid: 1,
  });
  assert.deepEqual(august.firstPaidCurrencies, [
    { currency: "RUB", paidCount: 1, paidMinor: 600000 },
  ]);
  assert.deepEqual(
    august.segments.map(({ sourceChannel, branchName }) => ({
      sourceChannel,
      branchName,
    })),
    [
      { sourceChannel: "phone", branchName: "Север" },
      { sourceChannel: "website", branchName: "Центр" },
    ],
  );
});

test("joint filters do not combine unrelated source and branch totals", () => {
  const august = buildBookingFunnelAnalytics(
    workspace(),
    "2026-08-18",
  ).periods.at(-1);
  const websiteCenter = aggregateBookingFunnelSegments(
    august.segments,
    "website",
    "branch-1",
  );
  assert.equal(websiteCenter.stages.trialBookings, 1);
  assert.equal(websiteCenter.stages.firstPaymentsPaid, 1);

  const websiteNorth = aggregateBookingFunnelSegments(
    august.segments,
    "website",
    "branch-2",
  );
  assert.equal(websiteNorth.stages.trialBookings, 0);
});
