import assert from "node:assert/strict";
import test from "node:test";

import { buildPaymentAnalytics } from "./bookingPaymentAnalytics.ts";

function payment(overrides) {
  return {
    id: crypto.randomUUID(),
    organizationId: "org-airhop",
    familyId: "family-airhop",
    childId: "child-airhop",
    enrollmentId: "enrollment-airhop",
    tariffId: "tariff-airhop",
    tariffNameSnapshot: "Два раза в неделю",
    amountMinor: 600000,
    currency: "RUB",
    dueDate: "2026-08-05",
    status: "expected",
    createdAt: "2026-08-01T10:00:00.000Z",
    updatedAt: "2026-08-01T10:00:00.000Z",
    ...overrides,
  };
}

test("payment analytics keeps currencies separate and classifies overdue", () => {
  const report = buildPaymentAnalytics(
    [
      payment({ status: "paid", paidAt: "2026-08-05T12:00:00.000Z" }),
      payment({ dueDate: "2026-08-10" }),
      payment({
        currency: "EUR",
        amountMinor: 8000,
        dueDate: "2026-08-25",
      }),
    ],
    "2026-08-18",
  );

  assert.deepEqual(
    report.currencies.map(({ currency }) => currency),
    ["EUR", "RUB"],
  );
  const rub = report.currencies[1];
  assert.equal(rub.openMinor, 600000);
  assert.equal(rub.overdueMinor, 600000);
  assert.equal(rub.periods.at(-1).scheduledMinor, 1200000);
  assert.equal(rub.periods.at(-1).paidShareBps, 5000);
  const eur = report.currencies[0];
  assert.equal(eur.openMinor, 8000);
  assert.equal(eur.overdueMinor, 0);
});

test("cancelled expectations stay visible but do not count as scheduled", () => {
  const report = buildPaymentAnalytics(
    [payment({ status: "cancelled", cancelledAt: "2026-08-02T10:00:00.000Z" })],
    "2026-08-18",
  );
  const current = report.currencies[0].periods.at(-1);
  assert.equal(current.scheduledMinor, 0);
  assert.equal(current.cancelledMinor, 600000);
  assert.equal(current.paidShareBps, null);
});

test("moving a due date does not move its immutable billing period", () => {
  const report = buildPaymentAnalytics(
    [
      payment({
        billingPeriod: "2026-07-01",
        dueDate: "2026-08-10",
      }),
    ],
    "2026-08-18",
  );
  const periods = report.currencies[0].periods;
  const july = periods.find(({ periodStart }) => periodStart === "2026-07-01");
  const august = periods.find(
    ({ periodStart }) => periodStart === "2026-08-01",
  );

  assert.equal(july.scheduledMinor, 600000);
  assert.equal(july.overdueMinor, 600000);
  assert.equal(august.scheduledMinor, 0);
});
