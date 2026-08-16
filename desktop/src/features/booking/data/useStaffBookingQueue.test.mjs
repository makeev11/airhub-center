import assert from "node:assert/strict";
import { test } from "node:test";

import { resolveStaffBookingQueueRuntime } from "./staffBookingQueueRuntime.ts";
import {
  executeStaffBookingDecision,
  mergeStaffBookingQueueItems,
  staffBookingQueueItemMatchesView,
  staffBookingQueueQueryForView,
} from "./useStaffBookingQueue.ts";

function queueItem(id, status = "pending_confirmation") {
  return {
    booking: {
      id,
      status,
      visitKind: "trial",
      transferRequest: null,
      lessonRef: {
        recurrenceRuleId: "20000000-0000-4000-8000-000000000001",
        originalDate: "2026-08-16",
      },
      version: 1,
      createdAt: "2026-08-15T12:00:00Z",
      updatedAt: "2026-08-15T12:00:00Z",
    },
    family: {
      id: "30000000-0000-4000-8000-000000000001",
      displayName: "Семья Марии",
    },
    representative: {
      id: "40000000-0000-4000-8000-000000000001",
      displayName: "Мария",
      phoneNormalized: "+79990000000",
      phoneDisplay: "+7 999 000-00-00",
      preferredContactChannel: "telegram",
    },
    child: {
      id: "50000000-0000-4000-8000-000000000001",
      displayName: "Миша",
      birthDate: "2020-05-20",
    },
    occurrence: {
      id: "60000000-0000-4000-8000-000000000001",
      date: "2026-08-16",
      startTime: "10:00",
      endTime: "11:00",
      status: "scheduled",
    },
    group: {
      id: "70000000-0000-4000-8000-000000000001",
      name: "Football 6–7",
    },
    branch: {
      id: "80000000-0000-4000-8000-000000000001",
      name: "Сокол",
    },
    attentionReasons: ["pending_confirmation"],
    requiresAttention: true,
  };
}

test("runtime selection isolates the authoritative queue from demo and E2E", () => {
  assert.equal(
    resolveStaffBookingQueueRuntime({ tauri: true, e2eMock: false }),
    "server",
  );
  assert.equal(
    resolveStaffBookingQueueRuntime({ tauri: false, e2eMock: false }),
    "workspace",
  );
  assert.equal(
    resolveStaffBookingQueueRuntime({ tauri: true, e2eMock: true }),
    "workspace",
  );
});

test("views use server filters and keep processed filtering deterministic", () => {
  assert.deepEqual(staffBookingQueueQueryForView("pending"), {
    status: "pending_confirmation",
    limit: 50,
  });
  assert.deepEqual(staffBookingQueueQueryForView("attention"), {
    attentionOnly: true,
    limit: 50,
  });
  assert.deepEqual(staffBookingQueueQueryForView("processed"), { limit: 50 });
  assert.equal(
    staffBookingQueueItemMatchesView(queueItem("pending"), "processed"),
    false,
  );
  assert.equal(
    staffBookingQueueItemMatchesView(
      queueItem("rejected", "rejected"),
      "processed",
    ),
    true,
  );
});

test("cursor pages replace duplicate booking identities", () => {
  const first = queueItem("first");
  const updated = queueItem("first", "confirmed");
  const second = queueItem("second");
  const merged = mergeStaffBookingQueueItems([first], [updated, second]);
  assert.deepEqual(
    merged.map((item) => [item.booking.id, item.booking.status]),
    [
      ["first", "confirmed"],
      ["second", "pending_confirmation"],
    ],
  );
});

test("accepted decisions refresh the projection without becoming retryable", async () => {
  const bookingId = "10000000-0000-4000-8000-000000000001";
  const calls = [];
  const outcome = await executeStaffBookingDecision({
    decisionService: {
      async decideBooking(input) {
        calls.push(["decision", input]);
        return {
          bookingId,
          status: "confirmed",
          notification: {
            kind: "messenger",
            channel: "telegram",
            state: "queued",
          },
          replayed: false,
        };
      },
    },
    async reload() {
      calls.push(["reload"]);
      throw new Error("projection temporarily unavailable");
    },
    bookingId,
    decision: "confirm",
  });
  assert.equal(outcome.status, "confirmed");
  assert.deepEqual(calls, [
    ["decision", { bookingId, decision: "confirm" }],
    ["reload"],
  ]);
});
