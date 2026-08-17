import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  HttpStaffPaymentService,
  StaffPaymentApiError,
} from "./staffPaymentService.ts";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PAYMENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FAMILY_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const CHILD_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const ENROLLMENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const TARIFF_ID = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const GROUP_ID = "11111111-1111-4111-8111-111111111111";

function signedEvent(input) {
  return {
    id: "event-id",
    pubkey: "staff-pubkey",
    created_at: 1,
    kind: input.kind,
    tags: input.tags,
    content: input.content,
    sig: "signature",
  };
}

function organization() {
  return {
    id: ORGANIZATION_ID,
    name: "Каляка Маляка",
    locale: "ru-RU",
    timeZone: "Europe/Moscow",
    defaultTrialPolicy: { mode: "free" },
    trackAttendanceByDefault: true,
    allowSingleVisitsByDefault: false,
    existingStudentsOnboarding: { status: "not_started" },
    publicBooking: { purpose: "trial", appearance: "automatic" },
    paymentDayOfMonth: 5,
  };
}

function queue() {
  return {
    organization: organization(),
    items: [
      {
        payment: {
          id: PAYMENT_ID,
          organizationId: ORGANIZATION_ID,
          familyId: FAMILY_ID,
          childId: CHILD_ID,
          enrollmentId: ENROLLMENT_ID,
          tariffId: TARIFF_ID,
          tariffNameSnapshot: "Два раза в неделю",
          amountMinor: 600000,
          currency: "RUB",
          dueDate: "2026-08-18",
          status: "expected",
          version: 3,
          createdAt: "2026-08-18T10:00:00Z",
          updatedAt: "2026-08-18T10:00:00Z",
        },
        family: { id: FAMILY_ID, displayName: "Семья Орловых" },
        child: { id: CHILD_ID, displayName: "Маша Орлова" },
        enrollment: { id: ENROLLMENT_ID },
        group: { id: GROUP_ID, name: "Полотна 8–10" },
      },
    ],
  };
}

test("payment service validates the authoritative queue projection", async () => {
  let requested;
  const service = new HttpStaffPaymentService({
    relayHttpUrl: async () => "https://center.example/",
    nonceFactory: () => "queue-nonce",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url, init) => {
      requested = { url: String(url), init };
      return new Response(JSON.stringify(queue()));
    },
  });

  const result = await service.listPayments();
  assert.equal(
    requested.url,
    "https://center.example/api/airhop/staff/v1/payments",
  );
  assert.equal(requested.init.method, "GET");
  assert.equal(result.items[0].payment.version, 3);
  assert.equal(result.items[0].family.displayName, "Семья Орловых");
});

test("payment move binds exact payload, path and idempotency key", async () => {
  let signedInput;
  let requested;
  const service = new HttpStaffPaymentService({
    relayHttpUrl: async () => "https://center.example/",
    idempotencyKeyFactory: () => "payment-command-12345",
    nonceFactory: () => "payment-nonce",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url: String(url), init };
      return new Response(
        JSON.stringify({ paymentId: PAYMENT_ID, version: 4, replayed: false }),
      );
    },
  });

  const outcome = await service.mutatePayment({
    paymentId: PAYMENT_ID,
    expectedVersion: 3,
    mutation: {
      action: "move_due_date",
      dueDate: "2026-08-25",
      reason: "По договорённости с семьёй",
    },
  });

  const expectedUrl = `https://center.example/api/airhop/staff/v1/payments/${PAYMENT_ID}`;
  assert.equal(requested.url, expectedUrl);
  assert.equal(requested.init.method, "PUT");
  assert.equal(
    requested.init.headers["Idempotency-Key"],
    "payment-command-12345",
  );
  assert.deepEqual(JSON.parse(requested.init.body), {
    action: "move_due_date",
    dueDate: "2026-08-25",
    reason: "По договорённости с семьёй",
    expectedVersion: 3,
  });
  assert.deepEqual(signedInput.tags.slice(0, 2), [
    ["u", expectedUrl],
    ["method", "PUT"],
  ]);
  assert.equal(
    signedInput.tags.find(([name]) => name === "payload")[1],
    createHash("sha256").update(requested.init.body).digest("hex"),
  );
  assert.equal(outcome.version, 4);
});

test("payment service exposes authoritative conflicts", async () => {
  const service = new HttpStaffPaymentService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async () =>
      new Response(JSON.stringify({ error: "payment changed" }), {
        status: 409,
      }),
  });
  await assert.rejects(
    service.mutatePayment({
      paymentId: PAYMENT_ID,
      expectedVersion: 3,
      mutation: { action: "mark_paid" },
    }),
    (error) =>
      error instanceof StaffPaymentApiError &&
      error.status === 409 &&
      error.message === "payment changed",
  );
});
