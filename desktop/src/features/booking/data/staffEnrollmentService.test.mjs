import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  HttpStaffEnrollmentService,
  StaffEnrollmentApiError,
} from "./staffEnrollmentService.ts";

const IDS = {
  family: "550e8400-e29b-41d4-a716-446655440001",
  child: "550e8400-e29b-41d4-a716-446655440002",
  group: "550e8400-e29b-41d4-a716-446655440003",
  tariff: "550e8400-e29b-41d4-a716-446655440004",
  rule: "550e8400-e29b-41d4-a716-446655440005",
  enrollment: "550e8400-e29b-41d4-a716-446655440006",
  payment: "550e8400-e29b-41d4-a716-446655440007",
};

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

test("direct enrollment signs the exact body and carries idempotency", async () => {
  let requested;
  let signedInput;
  const service = new HttpStaffEnrollmentService({
    relayHttpUrl: async () => "https://center.example/",
    idempotencyKeyFactory: () => "direct-enrollment-command",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({
          childId: IDS.child,
          enrollmentId: IDS.enrollment,
          paymentExpectationId: IDS.payment,
          enrollmentVersion: 1,
          paymentVersion: 1,
          replayed: false,
        }),
      );
    },
  });

  const outcome = await service.enroll({
    familyId: IDS.family,
    childId: IDS.child,
    groupId: IDS.group,
    tariffId: IDS.tariff,
    startDate: "2026-08-18",
    schedule: [{ recurrenceRuleId: IDS.rule, weekday: "tuesday" }],
  });

  const expectedBody = JSON.stringify({
    familyId: IDS.family,
    childId: IDS.child,
    groupId: IDS.group,
    tariffId: IDS.tariff,
    startDate: "2026-08-18",
    schedule: [{ recurrenceRuleId: IDS.rule, weekday: "tuesday" }],
  });
  assert.equal(
    requested.url,
    "https://center.example/api/airhop/staff/v1/enrollments",
  );
  assert.equal(requested.init.body, expectedBody);
  assert.equal(
    requested.init.headers["Idempotency-Key"],
    "direct-enrollment-command",
  );
  assert.deepEqual(signedInput.tags.slice(0, 3), [
    ["u", requested.url],
    ["method", "POST"],
    ["payload", createHash("sha256").update(expectedBody).digest("hex")],
  ]);
  assert.equal(outcome.paymentExpectationId, IDS.payment);
});

test("direct enrollment rejects malformed commands before transport", async () => {
  let requested = false;
  const service = new HttpStaffEnrollmentService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async () => {
      requested = true;
      return new Response();
    },
  });

  await assert.rejects(
    service.enroll({
      familyId: IDS.family,
      childId: IDS.child,
      groupId: IDS.group,
      tariffId: IDS.tariff,
      startDate: "2026-08-18",
      schedule: [],
    }),
    (error) => error instanceof StaffEnrollmentApiError && error.status === 400,
  );
  assert.equal(requested, false);
});
