import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  HttpStaffLessonService,
  StaffLessonApiError,
} from "./staffLessonService.ts";

const IDS = {
  rule: "550e8400-e29b-41d4-a716-446655440001",
  family: "550e8400-e29b-41d4-a716-446655440002",
  representative: "550e8400-e29b-41d4-a716-446655440003",
  child: "550e8400-e29b-41d4-a716-446655440004",
  booking: "550e8400-e29b-41d4-a716-446655440005",
  attendance: "550e8400-e29b-41d4-a716-446655440006",
};
const LESSON = { recurrenceRuleId: IDS.rule, originalDate: "2026-08-20" };

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

function validRoster() {
  return {
    lessonRef: LESSON,
    trackAttendance: true,
    items: [
      {
        familyId: IDS.family,
        familyName: "Семья Ивановых",
        representativeId: IDS.representative,
        representativeName: "Мария Иванова",
        childId: IDS.child,
        childName: "Анна",
        bookingId: IDS.booking,
        bookingStatus: "confirmed",
        visitKind: "trial",
        enrollmentId: null,
        activeGroupEnrollmentId: null,
        attendanceId: null,
        attendanceStatus: null,
        attendanceVersion: 0,
        attendanceMarkedAt: null,
      },
    ],
  };
}

test("lesson roster signs the exact bounded GET without command headers", async () => {
  let signedInput;
  let requested;
  const service = new HttpStaffLessonService({
    relayHttpUrl: async () => "https://center.example/",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(JSON.stringify(validRoster()));
    },
  });

  const roster = await service.getRoster(LESSON);
  const expectedUrl = `https://center.example/api/airhop/staff/v1/lessons/${IDS.rule}/2026-08-20/participants`;
  assert.equal(requested.url, expectedUrl);
  assert.equal(requested.init.method, "GET");
  assert.equal(requested.init.body, null);
  assert.equal(requested.init.headers["Idempotency-Key"], undefined);
  assert.deepEqual(signedInput.tags.slice(0, 2), [
    ["u", expectedUrl],
    ["method", "GET"],
  ]);
  assert.equal(roster.items[0].childName, "Анна");
});

test("direct participant command binds identity, payload and idempotency", async () => {
  let signedInput;
  let requested;
  const service = new HttpStaffLessonService({
    relayHttpUrl: async () => "https://center.example",
    idempotencyKeyFactory: () => "participant-command-12345",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({
          familyId: IDS.family,
          representativeId: IDS.representative,
          childId: IDS.child,
          bookingId: IDS.booking,
          participantStatus: "confirmed",
          visitKind: "trial",
          replayed: false,
        }),
      );
    },
  });

  await service.addParticipant({
    lessonRef: LESSON,
    client: {
      mode: "existing",
      familyId: IDS.family,
      representativeId: IDS.representative,
      childId: IDS.child,
    },
    visitKind: "trial",
  });

  const expectedBody = JSON.stringify({
    client: {
      mode: "existing",
      familyId: IDS.family,
      representativeId: IDS.representative,
      childId: IDS.child,
    },
    visitKind: "trial",
  });
  assert.equal(requested.init.method, "POST");
  assert.equal(requested.init.body, expectedBody);
  assert.equal(
    requested.init.headers["Idempotency-Key"],
    "participant-command-12345",
  );
  assert.deepEqual(signedInput.tags.slice(1, 3), [
    ["method", "POST"],
    ["payload", createHash("sha256").update(expectedBody).digest("hex")],
  ]);
});

test("new lesson participant preserves independent representative and child names", async () => {
  let requested;
  const service = new HttpStaffLessonService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({
          familyId: IDS.family,
          representativeId: IDS.representative,
          childId: IDS.child,
          bookingId: IDS.booking,
          participantStatus: "confirmed",
          visitKind: "single",
          replayed: false,
        }),
      );
    },
  });

  await service.addParticipant({
    lessonRef: LESSON,
    client: {
      mode: "new",
      parentName: "Ирина Соколова",
      parentFirstName: "Ирина",
      parentLastName: "Соколова",
      phone: "+7 999 123-45-67",
      childName: "Миша Петров",
      childFirstName: "Миша",
      childLastName: "Петров",
      childBirthDate: "2020-08-03",
    },
    visitKind: "single",
  });

  assert.deepEqual(JSON.parse(requested.init.body), {
    client: {
      mode: "new",
      parentName: "Ирина Соколова",
      parentFirstName: "Ирина",
      parentLastName: "Соколова",
      phone: "+7 999 123-45-67",
      childName: "Миша Петров",
      childFirstName: "Миша",
      childLastName: "Петров",
      childBirthDate: "2020-08-03",
    },
    visitKind: "single",
  });
});

test("attendance command addresses one child and can clear a mark", async () => {
  let requested;
  const service = new HttpStaffLessonService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({
          childId: IDS.child,
          attendanceId: null,
          status: null,
          version: 3,
          replayed: false,
        }),
      );
    },
  });

  await service.setAttendance({
    lessonRef: LESSON,
    childId: IDS.child,
    expectedVersion: 2,
    status: null,
    idempotencyKey: "attendance-command-12345",
  });

  assert.match(requested.url, new RegExp(`${IDS.child}/attendance$`));
  assert.equal(
    requested.init.body,
    JSON.stringify({ expectedVersion: 2, status: null }),
  );
  assert.equal(
    requested.init.headers["Idempotency-Key"],
    "attendance-command-12345",
  );
});

test("trial enrollment command carries tariff, start date and explicit weekly slots", async () => {
  let requested;
  const service = new HttpStaffLessonService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({
          childId: IDS.child,
          enrollmentId: "550e8400-e29b-41d4-a716-446655440007",
          paymentExpectationId: "550e8400-e29b-41d4-a716-446655440008",
          enrollmentVersion: 1,
          paymentVersion: 1,
          replayed: false,
        }),
      );
    },
  });

  await service.enrollTrial({
    lessonRef: LESSON,
    childId: IDS.child,
    tariffId: "550e8400-e29b-41d4-a716-446655440009",
    startDate: "2026-08-21",
    schedule: [{ recurrenceRuleId: IDS.rule, weekday: "thursday" }],
    idempotencyKey: "enrollment-command-12345",
  });

  assert.match(requested.url, new RegExp(`${IDS.child}/enrollment$`));
  assert.equal(requested.init.method, "POST");
  assert.deepEqual(JSON.parse(requested.init.body), {
    tariffId: "550e8400-e29b-41d4-a716-446655440009",
    startDate: "2026-08-21",
    schedule: [{ recurrenceRuleId: IDS.rule, weekday: "thursday" }],
  });
  assert.equal(
    requested.init.headers["Idempotency-Key"],
    "enrollment-command-12345",
  );
});

test("lesson service exposes authoritative conflict errors", async () => {
  const service = new HttpStaffLessonService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async () =>
      new Response(JSON.stringify({ error: "lesson is full" }), {
        status: 409,
      }),
  });

  await assert.rejects(
    service.addParticipant({
      lessonRef: LESSON,
      client: {
        mode: "existing",
        familyId: IDS.family,
        representativeId: IDS.representative,
        childId: IDS.child,
      },
      visitKind: "trial",
    }),
    (error) =>
      error instanceof StaffLessonApiError &&
      error.status === 409 &&
      error.message === "lesson is full",
  );
});
