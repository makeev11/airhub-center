import assert from "node:assert/strict";
import test from "node:test";

import {
  HttpStaffFamilyDetailService,
  StaffFamilyDetailApiError,
} from "./staffFamilyDetailService.ts";

const IDS = {
  organization: "550e8400-e29b-41d4-a716-446655440000",
  family: "550e8400-e29b-41d4-a716-446655440001",
  representative: "550e8400-e29b-41d4-a716-446655440002",
  child: "550e8400-e29b-41d4-a716-446655440003",
  enrollment: "550e8400-e29b-41d4-a716-446655440004",
  tariff: "550e8400-e29b-41d4-a716-446655440005",
  rule: "550e8400-e29b-41d4-a716-446655440006",
  group: "550e8400-e29b-41d4-a716-446655440007",
  branch: "550e8400-e29b-41d4-a716-446655440008",
  booking: "550e8400-e29b-41d4-a716-446655440009",
  occurrence: "550e8400-e29b-41d4-a716-446655440010",
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

function validDetail() {
  return {
    organization: {
      id: IDS.organization,
      name: "AirHub Сокол",
      locale: "ru-RU",
      timeZone: "Europe/Moscow",
      currentDate: "2026-08-16",
    },
    family: {
      id: IDS.family,
      displayName: "Семья Ивановых",
      primaryRepresentativeId: IDS.representative,
      status: "active",
      version: 1,
      createdAt: "2026-08-15T08:00:00Z",
      updatedAt: "2026-08-16T08:00:00Z",
    },
    representatives: [
      {
        id: IDS.representative,
        displayName: "Мария Иванова",
        firstName: "Мария",
        lastName: "Иванова",
        phoneNormalized: "+79991234567",
        phoneDisplay: "+7 999 123-45-67",
        preferredContactChannel: "telegram",
        verifiedMessengerChannels: ["telegram"],
        status: "active",
        version: 1,
        createdAt: "2026-08-15T08:00:00Z",
        updatedAt: "2026-08-16T08:00:00Z",
      },
    ],
    children: [
      {
        id: IDS.child,
        displayName: "Анна",
        firstName: "Анна",
        lastName: "Петрова",
        birthDate: "2019-05-20",
        note: "Любит футбол",
        status: "active",
        version: 1,
        createdAt: "2026-08-15T08:00:00Z",
        updatedAt: "2026-08-16T08:00:00Z",
      },
    ],
    enrollments: [
      {
        id: IDS.enrollment,
        childId: IDS.child,
        groupId: IDS.group,
        groupName: "Football 6–7",
        tariff: {
          id: IDS.tariff,
          name: "8 занятий",
          priceMinor: 800000,
          currency: "RUB",
        },
        startDate: "2026-08-01",
        endDate: null,
        status: "active",
        assignmentState: "configured",
        schedule: [
          {
            recurrenceRuleId: IDS.rule,
            weekday: "thursday",
            startTime: "10:00:00",
            endTime: "11:00:00",
          },
        ],
        version: 1,
        createdAt: "2026-08-15T08:00:00Z",
        updatedAt: "2026-08-16T08:00:00Z",
      },
    ],
    bookings: [
      {
        id: IDS.booking,
        representativeId: IDS.representative,
        childId: IDS.child,
        status: "pending_confirmation",
        visitKind: "trial",
        transferRequest: null,
        recurrenceRuleId: IDS.rule,
        originalDate: "2026-08-20",
        occurrenceId: IDS.occurrence,
        date: "2026-08-20",
        startTime: "10:00:00",
        endTime: "11:00:00",
        occurrenceStatus: "scheduled",
        groupId: IDS.group,
        groupName: "Football 6–7",
        branchId: IDS.branch,
        branchName: "Сокол",
        version: 1,
        createdAt: "2026-08-15T08:00:00Z",
        updatedAt: "2026-08-16T08:00:00Z",
      },
    ],
    bookingHistoryTruncated: false,
    hasPendingDuplicate: true,
  };
}

test("staff family detail signs and fetches the exact tenant-bound URL", async () => {
  let signedInput;
  let requested;
  const service = new HttpStaffFamilyDetailService({
    relayHttpUrl: async () => "https://center.example/",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(JSON.stringify(validDetail()));
    },
  });

  const detail = await service.getFamilyDetail(IDS.family);
  const expectedUrl = `https://center.example/api/airhop/staff/v1/families/${IDS.family}`;
  assert.equal(requested.url, expectedUrl);
  assert.equal(requested.init.method, "GET");
  assert.deepEqual(signedInput.tags.slice(0, 2), [
    ["u", expectedUrl],
    ["method", "GET"],
  ]);
  assert.equal(
    signedInput.tags.some(([kind]) => kind === "payload"),
    false,
  );
  assert.equal(detail.family.displayName, "Семья Ивановых");
  assert.equal(detail.representatives[0].firstName, "Мария");
  assert.equal(detail.children[0].lastName, "Петрова");
  assert.deepEqual(detail.representatives[0].verifiedMessengerChannels, [
    "telegram",
  ]);
});

test("staff family detail rejects invalid ids before signing or fetching", async () => {
  let signed = false;
  let fetched = false;
  const service = new HttpStaffFamilyDetailService({
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
    service.getFamilyDetail("not-a-family"),
    (error) =>
      error instanceof StaffFamilyDetailApiError && error.status === 400,
  );
  assert.equal(signed, false);
  assert.equal(fetched, false);
});

test("staff family detail preserves server errors and rejects unsafe shapes", async () => {
  const missing = new HttpStaffFamilyDetailService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async () =>
      new Response(JSON.stringify({ error: "AirHub resource not found" }), {
        status: 404,
      }),
  });
  await assert.rejects(
    missing.getFamilyDetail(IDS.family),
    (error) =>
      error instanceof StaffFamilyDetailApiError &&
      error.status === 404 &&
      error.message === "AirHub resource not found",
  );

  const unsafe = validDetail();
  unsafe.representatives[0].verifiedMessengerChannels = ["provider-internal"];
  const malformed = new HttpStaffFamilyDetailService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async () => new Response(JSON.stringify(unsafe)),
  });
  await assert.rejects(
    malformed.getFamilyDetail(IDS.family),
    (error) =>
      error instanceof StaffFamilyDetailApiError && error.status === 502,
  );
});
