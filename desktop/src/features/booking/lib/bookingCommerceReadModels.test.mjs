import assert from "node:assert/strict";
import test from "node:test";

import { parseBookingWorkspace } from "../model/bookingCore.ts";
import { DEMO_BOOKING_WORKSPACE } from "../model/demoSchedule.ts";
import { createConfiguredEnrollmentWithPayment } from "../model/bookingCommerce.ts";

let readModels = {};
try {
  readModels = await import("./bookingCommerceReadModels.ts");
} catch {
  // RED starts with no read-model module.
}

const NOW = "2026-08-06T09:00:00.000Z";

function workspaceWithCommerce() {
  const workspace = parseBookingWorkspace({
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
  const draft = createConfiguredEnrollmentWithPayment(workspace, {
    enrollment: {
      id: "enrollment-one",
      organizationId: "airhop",
      familyId: "family-one",
      childId: "child-one",
      groupId: "robotics-junior",
      startDate: "2026-08-03",
      status: "active",
      source: "staff_ui",
      createdBy: "owner-one",
      assignmentState: "configured",
      tariffId: "tariff-weekly-1",
      weeklyScheduleSelections: [
        {
          recurrenceRuleId: "robotics-junior-weekly",
          weekday: "monday",
        },
      ],
      createdAt: NOW,
      updatedAt: NOW,
    },
    payment: {
      id: "payment-one",
      organizationId: "airhop",
      familyId: "family-one",
      childId: "child-one",
      enrollmentId: "enrollment-one",
      tariffId: "tariff-weekly-1",
      tariffNameSnapshot: "1 раз в неделю",
      amountMinor: 400_000,
      currency: "RUB",
      dueDate: "2026-08-03",
      status: "expected",
      createdAt: NOW,
      updatedAt: NOW,
    },
  });
  return parseBookingWorkspace({ ...draft, revision: 1 });
}

test("payment queue computes overdue state and open-first sorting", () => {
  assert.equal(typeof readModels.paymentQueueRows, "function");
  const workspace = workspaceWithCommerce();
  const rows = readModels.paymentQueueRows(workspace, "2026-08-06");

  assert.equal(rows[0].displayState, "overdue");
  assert.equal(rows[0].child.displayName, "Лев Соколов");
  assert.equal(rows[0].tariff.name, "1 раз в неделю");
});

test("family and group read models expose configured enrollment", () => {
  const workspace = workspaceWithCommerce();
  const rows = readModels.familyEnrollmentRows(
    workspace,
    "family-one",
    "2026-08-06",
  );

  assert.equal(rows[0].group.name, "Робототехника Junior");
  assert.equal(rows[0].tariff.name, "1 раз в неделю");
  assert.equal(rows[0].openPayment.displayState, "overdue");
  assert.equal(
    readModels.groupActiveEnrollmentCount(
      workspace,
      "robotics-junior",
      "2026-08-06",
    ),
    1,
  );
});

test("server group enrollment count overrides incomplete local family data", () => {
  const workspace = workspaceWithCommerce();
  const groups = workspace.groups.map((group) =>
    group.id === "robotics-junior"
      ? { ...group, activeEnrollmentCount: 7 }
      : group,
  );
  const serverWorkspace = parseBookingWorkspace({ ...workspace, groups });

  assert.equal(
    readModels.groupActiveEnrollmentCount(
      serverWorkspace,
      "robotics-junior",
      "2026-08-06",
    ),
    7,
  );
});
