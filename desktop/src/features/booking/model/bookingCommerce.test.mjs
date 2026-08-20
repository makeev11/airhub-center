import assert from "node:assert/strict";
import test from "node:test";

import { parseBookingWorkspace } from "./bookingCore.ts";
import { DEMO_BOOKING_WORKSPACE } from "./demoSchedule.ts";
import { upsertBookingGroup } from "./bookingMutations.ts";

let commerce = {};
try {
  commerce = await import("./bookingCommerce.ts");
} catch {
  // RED starts with no commerce module. Assertions below describe its contract.
}

const NOW = "2026-08-06T09:00:00.000Z";

function workspaceWithClient() {
  return parseBookingWorkspace({
    ...DEMO_BOOKING_WORKSPACE,
    families: [
      {
        id: "family-petrova",
        organizationId: "airhop",
        displayName: "Семья Петровых",
        primaryRepresentativeId: "representative-petrova",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    representatives: [
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
        consentAcceptedAt: NOW,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    children: [
      {
        id: "child-masha",
        organizationId: "airhop",
        familyId: "family-petrova",
        displayName: "Маша Петрова",
        birthDate: "2020-06-15",
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  });
}

function configuredEnrollment(overrides = {}) {
  return {
    id: "enrollment-robotics",
    organizationId: "airhop",
    familyId: "family-petrova",
    childId: "child-masha",
    groupId: "robotics-junior",
    startDate: "2026-08-03",
    status: "active",
    source: "staff_ui",
    createdBy: "owner-one",
    assignmentState: "configured",
    tariffId: "tariff-weekly-2",
    weeklyScheduleSelections: [
      { recurrenceRuleId: "robotics-junior-weekly", weekday: "monday" },
    ],
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function firstPayment(overrides = {}) {
  return {
    id: "payment-enrollment-robotics-first",
    organizationId: "airhop",
    familyId: "family-petrova",
    childId: "child-masha",
    enrollmentId: "enrollment-robotics",
    tariffId: "tariff-weekly-2",
    tariffNameSnapshot: "2 раза в неделю",
    amountMinor: 600_000,
    currency: "RUB",
    dueDate: "2026-08-03",
    status: "expected",
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function savedWorkspace(draft, revision = 1) {
  return parseBookingWorkspace({ ...draft, revision });
}

test("configured enrollment and first payment are created atomically", () => {
  assert.equal(
    typeof commerce.createConfiguredEnrollmentWithPayment,
    "function",
  );
  const draft = commerce.createConfiguredEnrollmentWithPayment(
    workspaceWithClient(),
    {
      enrollment: configuredEnrollment(),
      payment: firstPayment(),
    },
  );

  assert.equal(draft.enrollments.at(-1).tariffId, "tariff-weekly-2");
  assert.equal(draft.paymentExpectations.at(-1).amountMinor, 600_000);
});

test("staff can enroll a child outside the group's recommended age range", () => {
  const workspace = workspaceWithClient();
  workspace.children.find((child) => child.id === "child-masha").birthDate =
    "2024-06-15";

  const draft = commerce.createConfiguredEnrollmentWithPayment(workspace, {
    enrollment: configuredEnrollment(),
    payment: firstPayment(),
  });

  assert.equal(draft.enrollments.at(-1).childId, "child-masha");
});

test("weekly slots must belong to the group and fit the tariff", () => {
  const workspace = workspaceWithClient();
  assert.throws(
    () =>
      commerce.createConfiguredEnrollmentWithPayment(workspace, {
        enrollment: configuredEnrollment({
          weeklyScheduleSelections: [
            {
              recurrenceRuleId: "animation-weekly",
              weekday: "monday",
            },
          ],
        }),
        payment: firstPayment(),
      }),
    (error) => error?.code === "invalid_weekly_selection",
  );

  const secondRule = {
    ...workspace.recurrenceRules.find(
      (rule) => rule.id === "robotics-junior-weekly",
    ),
    id: "robotics-junior-wednesday",
    weekdays: ["wednesday"],
  };
  const withSecondRule = parseBookingWorkspace({
    ...workspace,
    recurrenceRules: [...workspace.recurrenceRules, secondRule],
  });
  assert.throws(
    () =>
      commerce.createConfiguredEnrollmentWithPayment(withSecondRule, {
        enrollment: configuredEnrollment({
          tariffId: "tariff-weekly-1",
          weeklyScheduleSelections: [
            {
              recurrenceRuleId: "robotics-junior-weekly",
              weekday: "monday",
            },
            {
              recurrenceRuleId: "robotics-junior-wednesday",
              weekday: "wednesday",
            },
          ],
        }),
        payment: firstPayment({
          tariffId: "tariff-weekly-1",
          tariffNameSnapshot: "1 раз в неделю",
          amountMinor: 400_000,
        }),
      }),
    (error) => error?.code === "schedule_limit_exceeded",
  );
});

test("archived tariff cannot create a permanent enrollment", () => {
  const workspace = structuredClone(workspaceWithClient());
  workspace.tariffs.find((tariff) => tariff.id === "tariff-weekly-2").status =
    "archived";

  assert.throws(
    () =>
      commerce.createConfiguredEnrollmentWithPayment(workspace, {
        enrollment: configuredEnrollment(),
        payment: firstPayment(),
      }),
    (error) => error?.code === "archived_tariff",
  );
});

test("payment must snapshot the selected tariff and enrollment start date", () => {
  const workspace = workspaceWithClient();
  assert.throws(
    () =>
      commerce.createConfiguredEnrollmentWithPayment(workspace, {
        enrollment: configuredEnrollment(),
        payment: firstPayment({ amountMinor: 1, dueDate: "2026-08-04" }),
      }),
    (error) => error?.code === "invalid_payment_snapshot",
  );
  assert.deepEqual(workspace.enrollments, []);
  assert.deepEqual(workspace.paymentExpectations, []);
});

test("changing a tariff never rewrites an existing payment snapshot", () => {
  const enrolled = savedWorkspace(
    commerce.createConfiguredEnrollmentWithPayment(workspaceWithClient(), {
      enrollment: configuredEnrollment(),
      payment: firstPayment(),
    }),
  );
  const originalTariff = enrolled.tariffs.find(
    (tariff) => tariff.id === "tariff-weekly-2",
  );
  const changed = commerce.updateTariff(enrolled, {
    ...originalTariff,
    name: "Новая цена",
    priceMinor: 700_000,
    updatedAt: "2026-08-07T09:00:00.000Z",
  });

  assert.equal(
    changed.tariffs.find(({ id }) => id === originalTariff.id).priceMinor,
    700_000,
  );
  assert.equal(changed.paymentExpectations[0].amountMinor, 600_000);
  assert.equal(
    changed.paymentExpectations[0].tariffNameSnapshot,
    "2 раза в неделю",
  );
});

test("tariff transition preserves history and starts a new dated segment", () => {
  const initiallyEnrolled = savedWorkspace(
    commerce.createConfiguredEnrollmentWithPayment(workspaceWithClient(), {
      enrollment: configuredEnrollment(),
      payment: firstPayment(),
    }),
  );
  const enrolled = savedWorkspace({
    ...initiallyEnrolled,
    paymentExpectations: initiallyEnrolled.paymentExpectations.map(
      (payment) => ({ ...payment, dueDate: "2026-09-05" }),
    ),
  });
  const transitioned = commerce.transitionEnrollmentTariff(enrolled, {
    enrollmentId: "enrollment-robotics",
    tariffId: "tariff-weekly-1",
    weeklyScheduleSelections: [
      { recurrenceRuleId: "robotics-junior-weekly", weekday: "monday" },
    ],
    effectiveDate: "2026-09-05",
    newEnrollmentId: "enrollment-robotics-september",
    newPaymentId: "payment-enrollment-robotics-september",
    actorId: "owner-one",
    occurredAt: "2026-08-11T09:00:00.000Z",
  });

  const previous = transitioned.enrollments.find(
    ({ id }) => id === "enrollment-robotics",
  );
  const next = transitioned.enrollments.find(
    ({ id }) => id === "enrollment-robotics-september",
  );
  const previousPayment = transitioned.paymentExpectations.find(
    ({ id }) => id === "payment-enrollment-robotics-first",
  );
  const nextPayment = transitioned.paymentExpectations.find(
    ({ id }) => id === "payment-enrollment-robotics-september",
  );

  assert.equal(previous.endDate, "2026-09-04");
  assert.equal(previous.tariffId, "tariff-weekly-2");
  assert.equal(next.startDate, "2026-09-05");
  assert.equal(next.tariffId, "tariff-weekly-1");
  assert.equal(previousPayment.status, "cancelled");
  assert.equal(previousPayment.tariffId, "tariff-weekly-2");
  assert.equal(nextPayment.status, "expected");
  assert.equal(nextPayment.tariffId, "tariff-weekly-1");
  assert.equal(nextPayment.dueDate, "2026-09-05");
});

test("ending an enrollment can independently keep or cancel its payment", () => {
  const enrolled = savedWorkspace(
    commerce.createConfiguredEnrollmentWithPayment(workspaceWithClient(), {
      enrollment: configuredEnrollment(),
      payment: firstPayment(),
    }),
  );
  const kept = commerce.endEnrollment(enrolled, "enrollment-robotics", {
    endDate: "2026-08-31",
    cancelExpectedPayments: false,
    actorId: "owner-one",
    occurredAt: "2026-08-11T09:00:00.000Z",
  });
  assert.equal(kept.enrollments[0].endDate, "2026-08-31");
  assert.equal(kept.paymentExpectations[0].status, "expected");

  const cancelled = commerce.endEnrollment(enrolled, "enrollment-robotics", {
    endDate: "2026-08-31",
    cancelExpectedPayments: true,
    actorId: "owner-one",
    occurredAt: "2026-08-11T09:00:00.000Z",
  });
  assert.equal(cancelled.paymentExpectations[0].status, "cancelled");
  assert.equal(cancelled.paymentExpectations[0].cancelledBy, "owner-one");
});

test("expected payment can change amount, be paid, unmarked, cancelled and restored", () => {
  const enrolled = savedWorkspace(
    commerce.createConfiguredEnrollmentWithPayment(workspaceWithClient(), {
      enrollment: configuredEnrollment(),
      payment: firstPayment(),
    }),
  );
  const changedAmount = savedWorkspace(
    commerce.updateExpectedPaymentAmount(enrolled, firstPayment().id, {
      amountMinor: 300_000,
      updatedAt: "2026-08-07T09:00:00.000Z",
    }),
    2,
  );
  assert.equal(changedAmount.paymentExpectations[0].amountMinor, 300_000);

  const paid = savedWorkspace(
    commerce.setPaymentStatus(changedAmount, firstPayment().id, {
      status: "paid",
      actorId: "owner-one",
      occurredAt: "2026-08-07T10:00:00.000Z",
    }),
    3,
  );
  assert.equal(paid.paymentExpectations[0].paidBy, "owner-one");

  const expectedAgain = savedWorkspace(
    commerce.setPaymentStatus(paid, firstPayment().id, {
      status: "expected",
      actorId: "owner-one",
      occurredAt: "2026-08-07T10:05:00.000Z",
      internalReason: "Отметили по ошибке",
    }),
    4,
  );
  assert.equal(expectedAgain.paymentExpectations[0].paidAt, undefined);

  const cancelled = savedWorkspace(
    commerce.setPaymentStatus(expectedAgain, firstPayment().id, {
      status: "cancelled",
      actorId: "owner-one",
      occurredAt: "2026-08-07T10:10:00.000Z",
      internalReason: "Ученик ушёл",
    }),
    5,
  );
  assert.equal(cancelled.paymentExpectations[0].status, "cancelled");

  const restored = commerce.setPaymentStatus(cancelled, firstPayment().id, {
    status: "expected",
    actorId: "owner-one",
    occurredAt: "2026-08-07T10:15:00.000Z",
    internalReason: "Ученик вернулся",
  });
  assert.equal(restored.paymentExpectations[0].status, "expected");
  assert.equal(restored.paymentExpectations[0].cancelledAt, undefined);
});

test("expected payment due date can move without changing its tariff snapshot", () => {
  const enrolled = savedWorkspace(
    commerce.createConfiguredEnrollmentWithPayment(workspaceWithClient(), {
      enrollment: configuredEnrollment(),
      payment: firstPayment(),
    }),
  );
  const moved = commerce.updateExpectedPaymentDueDate(
    enrolled,
    firstPayment().id,
    {
      dueDate: "2026-09-10",
      updatedAt: "2026-08-07T11:00:00.000Z",
    },
  );
  assert.equal(moved.paymentExpectations[0].dueDate, "2026-09-10");
  assert.equal(moved.paymentExpectations[0].billingPeriod, "2026-08-01");
  assert.equal(moved.paymentExpectations[0].amountMinor, 600_000);
  assert.equal(
    moved.paymentExpectations[0].tariffNameSnapshot,
    "2 раза в неделю",
  );
  assert.throws(
    () =>
      commerce.updateExpectedPaymentDueDate(enrolled, firstPayment().id, {
        dueDate: firstPayment().dueDate,
        updatedAt: "2026-08-07T11:00:00.000Z",
      }),
    (error) => error?.code === "invalid_payment_transition",
  );
});

test("active configured enrollment protects its selected recurrence day", () => {
  const enrolled = savedWorkspace(
    commerce.createConfiguredEnrollmentWithPayment(workspaceWithClient(), {
      enrollment: configuredEnrollment(),
      payment: firstPayment(),
    }),
  );
  const group = enrolled.groups.find(
    (candidate) => candidate.id === "robotics-junior",
  );
  const rule = enrolled.recurrenceRules.find(
    (candidate) => candidate.id === "robotics-junior-weekly",
  );

  assert.throws(
    () =>
      upsertBookingGroup(enrolled, {
        group,
        activeRules: [{ ...rule, weekdays: ["tuesday"] }],
      }),
    /active enrollment/i,
  );
});

test("tariff catalog supports create, archive, restore, and reconfiguration", () => {
  const workspace = workspaceWithClient();
  const tariff = {
    id: "tariff-custom",
    organizationId: "airhop",
    name: "Индивидуальный",
    description: "Один день по выбору",
    priceMinor: 450_000,
    currency: "RUB",
    weeklyScheduleLimit: 1,
    paymentDayOfMonth: 10,
    status: "active",
    createdAt: NOW,
    updatedAt: NOW,
  };
  const created = savedWorkspace(commerce.createTariff(workspace, tariff));
  assert.equal(created.tariffs.at(-1).paymentDayOfMonth, 10);

  const archived = savedWorkspace(
    commerce.setTariffStatus(
      created,
      tariff.id,
      "archived",
      "2026-08-07T09:00:00.000Z",
    ),
    2,
  );
  assert.equal(
    archived.tariffs.find((candidate) => candidate.id === tariff.id).status,
    "archived",
  );

  const restored = savedWorkspace(
    commerce.setTariffStatus(
      archived,
      tariff.id,
      "active",
      "2026-08-07T10:00:00.000Z",
    ),
    3,
  );
  const legacyEnrollment = {
    ...configuredEnrollment({
      id: "legacy-enrollment",
      assignmentState: "needs_assignment",
      weeklyScheduleSelections: [],
    }),
  };
  delete legacyEnrollment.tariffId;
  const withLegacy = parseBookingWorkspace({
    ...restored,
    enrollments: [legacyEnrollment],
  });
  const configured = commerce.reconfigureEnrollment(
    withLegacy,
    configuredEnrollment({ id: "legacy-enrollment" }),
  );
  assert.equal(configured.enrollments[0].assignmentState, "configured");
});

test("persisted payment statuses require their audit fields", () => {
  const enrolled = savedWorkspace(
    commerce.createConfiguredEnrollmentWithPayment(workspaceWithClient(), {
      enrollment: configuredEnrollment(),
      payment: firstPayment(),
    }),
  );
  const invalidPaid = structuredClone(enrolled);
  invalidPaid.paymentExpectations[0].status = "paid";
  assert.throws(() => parseBookingWorkspace(invalidPaid));

  const invalidCancelled = structuredClone(enrolled);
  invalidCancelled.paymentExpectations[0].status = "cancelled";
  invalidCancelled.paymentExpectations[0].cancelledAt = NOW;
  invalidCancelled.paymentExpectations[0].cancelledBy = "owner-one";
  assert.throws(() => parseBookingWorkspace(invalidCancelled));
});

test("persisted commerce records reject broken references", () => {
  const enrolled = savedWorkspace(
    commerce.createConfiguredEnrollmentWithPayment(workspaceWithClient(), {
      enrollment: configuredEnrollment(),
      payment: firstPayment(),
    }),
  );
  const unknownTariff = structuredClone(enrolled);
  unknownTariff.enrollments[0].tariffId = "missing-tariff";
  assert.throws(
    () => parseBookingWorkspace(unknownTariff),
    /Unknown tariff missing-tariff/,
  );

  const wrongPaymentChild = structuredClone(enrolled);
  wrongPaymentChild.paymentExpectations[0].childId = "missing-child";
  assert.throws(() => parseBookingWorkspace(wrongPaymentChild));
});
