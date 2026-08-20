import assert from "node:assert/strict";
import test from "node:test";

import {
  minimumTariffTransitionDate,
  nextEnrollmentBillingDate,
} from "./bookingEnrollmentTransitions.ts";

test("next billing date uses the upcoming payment day", () => {
  assert.equal(nextEnrollmentBillingDate("2026-08-11", 20), "2026-08-20");
  assert.equal(nextEnrollmentBillingDate("2026-08-11", 5), "2026-09-05");
  assert.equal(nextEnrollmentBillingDate("2026-12-28", 28), "2027-01-28");
});

test("tariff transition starts no earlier than today and after enrollment", () => {
  assert.equal(
    minimumTariffTransitionDate("2026-08-03", "2026-08-11"),
    "2026-08-11",
  );
  assert.equal(
    minimumTariffTransitionDate("2026-08-11", "2026-08-11"),
    "2026-08-12",
  );
});
