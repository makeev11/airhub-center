import assert from "node:assert/strict";
import test from "node:test";

import {
  HttpStaffBookingQueueService,
  StaffBookingQueueApiError,
} from "./staffBookingQueueService.ts";

const IDS = {
  booking: "550e8400-e29b-41d4-a716-446655440000",
  family: "550e8400-e29b-41d4-a716-446655440001",
  representative: "550e8400-e29b-41d4-a716-446655440002",
  child: "550e8400-e29b-41d4-a716-446655440003",
  occurrence: "550e8400-e29b-41d4-a716-446655440004",
  rule: "550e8400-e29b-41d4-a716-446655440005",
  group: "550e8400-e29b-41d4-a716-446655440006",
  branch: "550e8400-e29b-41d4-a716-446655440007",
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

function validPage() {
  return {
    items: [
      {
        booking: {
          id: IDS.booking,
          status: "pending_confirmation",
          visitKind: "trial",
          transferRequest: null,
          lessonRef: {
            recurrenceRuleId: IDS.rule,
            originalDate: "2026-08-20",
          },
          version: 1,
          createdAt: "2026-08-16T08:00:00Z",
          updatedAt: "2026-08-16T08:00:00Z",
        },
        family: { id: IDS.family, displayName: "Семья Ивановых" },
        representative: {
          id: IDS.representative,
          displayName: "Мария Иванова",
          phoneNormalized: "+79991234567",
          phoneDisplay: "+7 999 123-45-67",
          preferredContactChannel: "telegram",
        },
        child: {
          id: IDS.child,
          displayName: "Анна",
          birthDate: "2019-05-20",
        },
        occurrence: {
          id: IDS.occurrence,
          date: "2026-08-20",
          startTime: "10:00",
          endTime: "11:00",
          status: "scheduled",
        },
        group: { id: IDS.group, name: "Football 6–7" },
        branch: { id: IDS.branch, name: "Сокол" },
        attentionReasons: ["pending_confirmation"],
        requiresAttention: true,
      },
    ],
    nextCursor: {
      priority: 0,
      updatedAt: "2026-08-16T08:00:00Z",
      bookingId: IDS.booking,
    },
  };
}

test("staff queue binds the exact filtered GET URL without a payload tag", async () => {
  let signedInput;
  let requested;
  const service = new HttpStaffBookingQueueService({
    relayHttpUrl: async () => "https://center.example/",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(JSON.stringify(validPage()));
    },
  });

  const page = await service.listBookingRequests({
    status: "pending_confirmation",
    attentionOnly: true,
    limit: 25,
  });

  const expectedUrl =
    "https://center.example/api/airhop/staff/v1/booking-requests?status=pending_confirmation&attentionOnly=true&limit=25";
  assert.equal(requested.url, expectedUrl);
  assert.equal(requested.init.method, "GET");
  assert.deepEqual(signedInput.tags.slice(0, 2), [
    ["u", expectedUrl],
    ["method", "GET"],
  ]);
  assert.equal(signedInput.tags[2][0], "nonce");
  assert.equal(
    signedInput.tags.some(([kind]) => kind === "payload"),
    false,
  );
  assert.equal(page.items[0].booking.status, "pending_confirmation");
});

test("staff queue sends every composite cursor component", async () => {
  let requestedUrl;
  const service = new HttpStaffBookingQueueService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ items: [], nextCursor: null }));
    },
  });
  await service.listBookingRequests({ cursor: validPage().nextCursor });
  const parsed = new URL(requestedUrl);
  assert.equal(parsed.searchParams.get("cursorPriority"), "0");
  assert.equal(
    parsed.searchParams.get("cursorUpdatedAt"),
    "2026-08-16T08:00:00Z",
  );
  assert.equal(parsed.searchParams.get("cursorBookingId"), IDS.booking);
});

test("staff queue rejects an invalid limit before signing or fetching", async () => {
  let signed = false;
  let fetched = false;
  const service = new HttpStaffBookingQueueService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => {
      signed = true;
      return signedEvent(input);
    },
    fetch: async () => {
      fetched = true;
      return new Response("{}");
    },
  });
  await assert.rejects(
    service.listBookingRequests({ limit: 101 }),
    (error) =>
      error instanceof StaffBookingQueueApiError && error.status === 400,
  );
  assert.equal(signed, false);
  assert.equal(fetched, false);
});

test("staff queue exposes server errors and rejects malformed success data", async () => {
  const forbidden = new HttpStaffBookingQueueService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async () =>
      new Response(JSON.stringify({ error: "membership required" }), {
        status: 403,
      }),
  });
  await assert.rejects(
    forbidden.listBookingRequests(),
    (error) =>
      error instanceof StaffBookingQueueApiError &&
      error.status === 403 &&
      error.message === "membership required",
  );

  const malformed = new HttpStaffBookingQueueService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async () => new Response(JSON.stringify({ items: [{}] })),
  });
  await assert.rejects(
    malformed.listBookingRequests(),
    (error) =>
      error instanceof StaffBookingQueueApiError && error.status === 502,
  );
});
