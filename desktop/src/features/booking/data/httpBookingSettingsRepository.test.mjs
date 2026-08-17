import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { BookingRevisionConflictError } from "./bookingRepository.ts";
import {
  BookingSettingsApiError,
  HttpBookingSettingsRepository,
} from "./httpBookingSettingsRepository.ts";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

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

function organization(overrides = {}) {
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
    ...overrides,
  };
}

function settingsResponse(version, overrides = {}) {
  return {
    organization: organization(overrides),
    version,
    replayed: false,
  };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("settings repository bootstraps an unconfigured Center with version zero", async () => {
  const requests = [];
  const signedInputs = [];
  const repository = new HttpBookingSettingsRepository({
    relayHttpUrl: async () => "https://center.example/",
    idempotencyKeyFactory: () => "settings-command-1234567890",
    nonceFactory: () => "nonce-1",
    initialOrganization: () => organization({ id: "unconfigured" }),
    signEvent: async (input) => {
      signedInputs.push(input);
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (init.method === "GET") {
        return jsonResponse({ error: "not configured" }, 404);
      }
      return jsonResponse(settingsResponse(1));
    },
  });

  const initial = await repository.load();
  assert.equal(initial.revision, 0);
  assert.equal(initial.organization.id, "unconfigured");
  assert.deepEqual(initial.branches, []);

  const { revision: _revision, ...draft } = initial;
  const saved = await repository.save(
    {
      ...draft,
      organization: { ...draft.organization, name: "Каляка Маляка" },
    },
    0,
  );

  const put = requests[1];
  const body = JSON.parse(put.init.body);
  assert.equal(put.url, "https://center.example/api/airhop/staff/v1/settings");
  assert.equal(put.init.method, "PUT");
  assert.equal(
    put.init.headers["Idempotency-Key"],
    "settings-command-1234567890",
  );
  assert.equal(body.expectedVersion, 0);
  assert.equal(body.existingStudentsOnboardingStatus, "not_started");
  assert.equal(saved.revision, 1);
  assert.deepEqual(signedInputs[0].tags.slice(0, 2), [
    ["u", "https://center.example/api/airhop/staff/v1/settings"],
    ["method", "GET"],
  ]);
  const payloadTag = signedInputs[1].tags.find(([name]) => name === "payload");
  assert.equal(
    payloadTag[1],
    createHash("sha256").update(put.init.body).digest("hex"),
  );
});

test("settings repository loads and saves the authoritative organization", async () => {
  const requests = [];
  const repository = new HttpBookingSettingsRepository({
    relayHttpUrl: async () => "https://center.example",
    idempotencyKeyFactory: () => "settings-command-1234567890",
    nonceFactory: () => "nonce-2",
    signEvent: async (input) => signedEvent(input),
    fetch: async (_url, init) => {
      requests.push(init);
      return init.method === "GET"
        ? jsonResponse(settingsResponse(4))
        : jsonResponse(
            settingsResponse(5, {
              publicBooking: { purpose: "lesson", appearance: "dark" },
            }),
          );
    },
  });

  const current = await repository.load();
  const { revision: _revision, ...draft } = current;
  const saved = await repository.save(
    {
      ...draft,
      organization: {
        ...draft.organization,
        publicBooking: { purpose: "lesson", appearance: "dark" },
      },
    },
    current.revision,
  );

  assert.equal(current.revision, 4);
  assert.equal(saved.revision, 5);
  assert.equal(saved.organization.publicBooking.purpose, "lesson");
  assert.equal(JSON.parse(requests[1].body).expectedVersion, 4);
});

test("settings repository maps a stale write to a revision conflict", async () => {
  let call = 0;
  const repository = new HttpBookingSettingsRepository({
    relayHttpUrl: async () => "https://center.example",
    nonceFactory: () => `nonce-${call}`,
    signEvent: async (input) => signedEvent(input),
    fetch: async () => {
      call += 1;
      return call === 1
        ? jsonResponse({ error: "reload before saving" }, 409)
        : jsonResponse(settingsResponse(7));
    },
  });
  const current = settingsResponse(6).organization;

  await assert.rejects(
    repository.save(
      {
        schemaVersion: 8,
        organization: current,
        branches: [],
        rooms: [],
        teachers: [],
        groups: [],
        recurrenceRules: [],
        lessonExceptions: [],
        families: [],
        representatives: [],
        children: [],
        duplicateCandidates: [],
        bookings: [],
        tariffs: [],
        enrollments: [],
        paymentExpectations: [],
        intakeRequests: [],
        pendingActions: [],
        attendanceRecords: [],
      },
      6,
    ),
    (error) =>
      error instanceof BookingRevisionConflictError &&
      error.expectedRevision === 6 &&
      error.actualRevision === 7,
  );
});

test("settings repository rejects malformed success payloads", async () => {
  const repository = new HttpBookingSettingsRepository({
    relayHttpUrl: async () => "https://center.example",
    nonceFactory: () => "nonce",
    signEvent: async (input) => signedEvent(input),
    fetch: async () => jsonResponse({ ok: true }),
  });

  await assert.rejects(
    repository.load(),
    (error) => error instanceof BookingSettingsApiError && error.status === 502,
  );
});
