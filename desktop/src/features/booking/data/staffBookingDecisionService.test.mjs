import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  HttpStaffBookingDecisionService,
  StaffBookingDecisionApiError,
} from "./staffBookingDecisionService.ts";

const BOOKING_ID = "550e8400-e29b-41d4-a716-446655440000";

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

test("staff decision binds exact URL, payload and idempotency key", async () => {
  let signedInput;
  let requested;
  const service = new HttpStaffBookingDecisionService({
    relayHttpUrl: async () => "https://center.example/",
    idempotencyKeyFactory: () => "decision-key-1234567890",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({
          bookingId: BOOKING_ID,
          status: "confirmed",
          notification: {
            kind: "messenger",
            channel: "telegram",
            state: "queued",
          },
          replayed: false,
        }),
      );
    },
  });

  const outcome = await service.decideBooking({
    bookingId: BOOKING_ID,
    decision: "confirm",
  });

  const expectedUrl = `https://center.example/api/airhop/staff/v1/bookings/${BOOKING_ID}/decision`;
  const expectedBody = JSON.stringify({ decision: "confirm" });
  assert.equal(requested.url, expectedUrl);
  assert.equal(requested.init.method, "POST");
  assert.equal(requested.init.body, expectedBody);
  assert.equal(
    requested.init.headers["Idempotency-Key"],
    "decision-key-1234567890",
  );
  assert.deepEqual(signedInput.tags.slice(0, 3), [
    ["u", expectedUrl],
    ["method", "POST"],
    ["payload", createHash("sha256").update(expectedBody).digest("hex")],
  ]);
  assert.equal(signedInput.tags[3][0], "nonce");
  assert.match(requested.init.headers.Authorization, /^Nostr /);
  assert.deepEqual(outcome.notification, {
    kind: "messenger",
    channel: "telegram",
    state: "queued",
  });
});

test("staff decision preserves the same key for a deliberate retry", async () => {
  const seenKeys = [];
  const service = new HttpStaffBookingDecisionService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async (_url, init) => {
      seenKeys.push(init.headers["Idempotency-Key"]);
      return new Response(
        JSON.stringify({
          bookingId: BOOKING_ID,
          status: "rejected",
          notification: { kind: "staff_call", state: "queued" },
          replayed: seenKeys.length > 1,
        }),
      );
    },
  });

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await service.decideBooking({
      bookingId: BOOKING_ID,
      decision: "reject",
      idempotencyKey: "same-command-key-12345",
    });
  }
  assert.deepEqual(seenKeys, [
    "same-command-key-12345",
    "same-command-key-12345",
  ]);
});

test("staff decision exposes authoritative conflict errors", async () => {
  const service = new HttpStaffBookingDecisionService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async () =>
      new Response(JSON.stringify({ error: "invalid booking transition" }), {
        status: 409,
      }),
  });

  await assert.rejects(
    service.decideBooking({
      bookingId: BOOKING_ID,
      decision: "confirm",
    }),
    (error) =>
      error instanceof StaffBookingDecisionApiError &&
      error.status === 409 &&
      error.message === "invalid booking transition",
  );
});

test("staff decision rejects malformed success payloads", async () => {
  const service = new HttpStaffBookingDecisionService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async () => new Response(JSON.stringify({ ok: true })),
  });

  await assert.rejects(
    service.decideBooking({
      bookingId: BOOKING_ID,
      decision: "confirm",
    }),
    (error) =>
      error instanceof StaffBookingDecisionApiError && error.status === 502,
  );
});
