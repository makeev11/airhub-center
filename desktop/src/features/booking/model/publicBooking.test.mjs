import assert from "node:assert/strict";
import test from "node:test";

import {
  digestPublicBookingCredential,
  generatePublicBookingToken,
} from "../lib/publicBookingSecurity.ts";
import {
  ageInMonthsOnDate,
  canTransitionBookingStatus,
  isBirthMonthPotentiallyEligible,
  isExactBirthDateEligible,
  maskPublicBookingPhone,
  normalizePublicBookingPhone,
  stableLessonReferenceKey,
  transitionBookingStatus,
  validatePublicApplicantDraft,
} from "./publicBooking.ts";

function booking(status = "pending_confirmation") {
  return {
    id: "booking-1",
    organizationId: "airhop",
    lessonRef: {
      recurrenceRuleId: "robotics-weekly",
      originalDate: "2026-08-10",
    },
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
    status,
    transferRequest: null,
    managementTokenDigest: "a".repeat(64),
    idempotencyKeyDigest: "b".repeat(64),
    source: { surface: "standalone" },
    createdAt: "2026-08-04T09:00:00.000Z",
    updatedAt: "2026-08-04T09:00:00.000Z",
  };
}

test("public booking keeps a stable rule and original-date reference", () => {
  const reference = {
    recurrenceRuleId: "robotics-weekly",
    originalDate: "2026-08-10",
  };

  assert.equal(
    stableLessonReferenceKey(reference),
    "robotics-weekly:2026-08-10",
  );
  assert.equal(
    stableLessonReferenceKey({ ...reference }),
    stableLessonReferenceKey(reference),
  );
});

test("public booking calculates completed months at exact day boundaries", () => {
  assert.equal(ageInMonthsOnDate("2020-08-10", "2026-08-09"), 71);
  assert.equal(ageInMonthsOnDate("2020-08-10", "2026-08-10"), 72);
  assert.equal(ageInMonthsOnDate("2020-08-31", "2026-02-28"), 65);
  assert.equal(ageInMonthsOnDate("invalid", "2026-08-10"), -1);

  const limits = { minAgeMonths: 72, maxAgeMonths: 96 };
  assert.equal(
    isExactBirthDateEligible(limits, "2020-08-10", "2026-08-10"),
    true,
  );
  assert.equal(
    isExactBirthDateEligible(limits, "2020-08-11", "2026-08-10"),
    false,
  );
  assert.equal(
    isExactBirthDateEligible(limits, "2018-08-10", "2026-08-10"),
    true,
  );
  assert.equal(
    isExactBirthDateEligible(limits, "2018-07-10", "2026-08-10"),
    false,
  );
});

test("birth-month filtering retains only months with a potentially valid day", () => {
  const exactSixYears = { minAgeMonths: 72, maxAgeMonths: 72 };

  assert.equal(
    isBirthMonthPotentiallyEligible(exactSixYears, 2020, 8, "2026-08-15"),
    true,
  );
  assert.equal(
    isBirthMonthPotentiallyEligible(exactSixYears, 2020, 9, "2026-08-15"),
    false,
  );
  assert.equal(
    isBirthMonthPotentiallyEligible(exactSixYears, 2020, 13, "2026-08-15"),
    false,
  );
});

test("public applicant validation normalizes phones and requires consent", () => {
  assert.equal(
    normalizePublicBookingPhone("8 (999) 123-45-67"),
    "+79991234567",
  );
  assert.equal(normalizePublicBookingPhone("999 123 45 67"), "+79991234567");
  assert.equal(normalizePublicBookingPhone("123"), null);
  assert.equal(maskPublicBookingPhone("+79991234567"), "+79 ••• ••• 45 67");

  assert.deepEqual(
    validatePublicApplicantDraft({
      parentName: " ",
      phone: "123",
      childName: "",
      childBirthDate: "2026-02-31",
      consentAccepted: false,
    }),
    [
      "parent_name_required",
      "phone_invalid",
      "child_name_required",
      "birth_date_invalid",
      "consent_required",
    ],
  );

  assert.deepEqual(
    validatePublicApplicantDraft(
      {
        parentName: "Мария",
        phone: "+7 999 123-45-67",
        childName: "Лев",
        childBirthDate: "2026-08-05",
        consentAccepted: true,
      },
      "2026-08-04",
    ),
    ["birth_date_in_future"],
  );
});

test("booking status transitions are explicit and idempotent", () => {
  assert.equal(
    canTransitionBookingStatus("pending_confirmation", "confirmed"),
    true,
  );
  assert.equal(
    canTransitionBookingStatus("confirmed", "cancelled_by_parent"),
    true,
  );
  assert.equal(canTransitionBookingStatus("rejected", "confirmed"), false);

  const source = booking();
  const confirmed = transitionBookingStatus(
    source,
    "confirmed",
    "2026-08-04T10:00:00.000Z",
  );
  assert.equal(confirmed.status, "confirmed");
  assert.equal(
    transitionBookingStatus(confirmed, "confirmed", "later"),
    confirmed,
  );
  assert.throws(
    () => transitionBookingStatus(booking("rejected"), "confirmed", "later"),
    /Invalid booking transition/,
  );

  const cancelled = transitionBookingStatus(
    {
      ...booking(),
      transferRequest: {
        status: "pending",
        requestedAt: "2026-08-04T09:30:00.000Z",
      },
    },
    "cancelled_by_parent",
    "2026-08-04T10:00:00.000Z",
  );
  assert.equal(cancelled.transferRequest, null);
});

test("management credentials have 256-bit entropy and persist only as digest", async () => {
  const token = generatePublicBookingToken();
  const second = generatePublicBookingToken();
  const digest = await digestPublicBookingCredential(token);

  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(token, second);
  assert.match(digest, /^[a-f0-9]{64}$/);
  assert.notEqual(digest, token);
  assert.equal(await digestPublicBookingCredential(token), digest);
});
