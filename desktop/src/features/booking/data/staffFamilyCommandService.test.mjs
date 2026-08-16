import assert from "node:assert/strict";
import test from "node:test";

import {
  HttpStaffFamilyCommandService,
  StaffFamilyCommandApiError,
} from "./staffFamilyCommandService.ts";

const FAMILY_ID = "550e8400-e29b-41d4-a716-446655440001";
const REPRESENTATIVE_ID = "550e8400-e29b-41d4-a716-446655440002";
const CHILD_ID = "550e8400-e29b-41d4-a716-446655440003";

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

function updateInput() {
  return {
    familyId: FAMILY_ID,
    representativeId: REPRESENTATIVE_ID,
    expectedVersion: 3,
    displayName: "  Мария Иванова  ",
    phone: "  +7 999 123-45-67  ",
    preferredContactChannel: "telegram",
    idempotencyKey: "representative-update-1",
  };
}

test("representative update signs the exact PUT payload and URL", async () => {
  let signedInput;
  let requested;
  const service = new HttpStaffFamilyCommandService({
    relayHttpUrl: async () => "https://center.example/",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({
          representativeId: REPRESENTATIVE_ID,
          version: 4,
          hasPendingDuplicate: false,
          replayed: false,
        }),
      );
    },
  });

  const outcome = await service.updateRepresentative(updateInput());
  const expectedUrl = `https://center.example/api/airhop/staff/v1/families/${FAMILY_ID}/representatives/${REPRESENTATIVE_ID}`;
  const expectedBody = JSON.stringify({
    expectedVersion: 3,
    displayName: "Мария Иванова",
    phone: "+7 999 123-45-67",
    preferredContactChannel: "telegram",
  });
  assert.equal(requested.url, expectedUrl);
  assert.equal(requested.init.method, "PUT");
  assert.equal(requested.init.body, expectedBody);
  assert.equal(
    requested.init.headers["Idempotency-Key"],
    "representative-update-1",
  );
  assert.deepEqual(signedInput.tags.slice(0, 2), [
    ["u", expectedUrl],
    ["method", "PUT"],
  ]);
  assert.equal(signedInput.tags[2][0], "payload");
  assert.equal(signedInput.tags[2][1].length, 64);
  assert.equal(outcome.version, 4);
});

test("representative update validates identity before signing or fetching", async () => {
  let signed = false;
  let fetched = false;
  const service = new HttpStaffFamilyCommandService({
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
    service.updateRepresentative({ ...updateInput(), familyId: "demo-family" }),
    (error) =>
      error instanceof StaffFamilyCommandApiError && error.status === 400,
  );
  assert.equal(signed, false);
  assert.equal(fetched, false);
});

test("representative update preserves optimistic conflict details", async () => {
  const service = new HttpStaffFamilyCommandService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: "AirHub entity changed; reload before saving",
        }),
        { status: 409 },
      ),
  });
  await assert.rejects(
    service.updateRepresentative(updateInput()),
    (error) =>
      error instanceof StaffFamilyCommandApiError &&
      error.status === 409 &&
      error.message === "AirHub entity changed; reload before saving",
  );
});

test("family update uses the family resource and trims its label", async () => {
  let requested;
  const service = new HttpStaffFamilyCommandService({
    relayHttpUrl: async () => "https://center.example/",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({ familyId: FAMILY_ID, version: 2, replayed: false }),
      );
    },
  });
  await service.updateFamily({
    familyId: FAMILY_ID,
    expectedVersion: 1,
    displayName: "  Семья Ивановых  ",
    idempotencyKey: "family-update-0001",
  });
  assert.equal(
    requested.url,
    `https://center.example/api/airhop/staff/v1/families/${FAMILY_ID}`,
  );
  assert.deepEqual(JSON.parse(requested.init.body), {
    expectedVersion: 1,
    displayName: "Семья Ивановых",
  });
});

test("child update normalizes an empty note and signs its child resource", async () => {
  let requested;
  let signedInput;
  const service = new HttpStaffFamilyCommandService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({ childId: CHILD_ID, version: 5, replayed: false }),
      );
    },
  });
  await service.updateChild({
    familyId: FAMILY_ID,
    childId: CHILD_ID,
    expectedVersion: 4,
    displayName: " Анна ",
    birthDate: "2019-05-20",
    note: "   ",
  });
  const expectedUrl = `https://center.example/api/airhop/staff/v1/families/${FAMILY_ID}/children/${CHILD_ID}`;
  assert.equal(requested.url, expectedUrl);
  assert.deepEqual(JSON.parse(requested.init.body), {
    expectedVersion: 4,
    displayName: "Анна",
    birthDate: "2019-05-20",
    note: null,
  });
  assert.deepEqual(signedInput.tags.slice(0, 2), [
    ["u", expectedUrl],
    ["method", "PUT"],
  ]);
});

test("representative creation signs its POST collection resource", async () => {
  let requested;
  let signedInput;
  const service = new HttpStaffFamilyCommandService({
    relayHttpUrl: async () => "https://center.example/",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({
          representativeId: REPRESENTATIVE_ID,
          hasPendingDuplicate: true,
          replayed: false,
        }),
      );
    },
  });
  await service.addRepresentative({
    familyId: FAMILY_ID,
    displayName: "  Иван Иванов  ",
    phone: "  +7 999 111-22-33  ",
    preferredContactChannel: "phone",
    idempotencyKey: "representative-create-1",
  });
  const expectedUrl = `https://center.example/api/airhop/staff/v1/families/${FAMILY_ID}/representatives`;
  assert.equal(requested.url, expectedUrl);
  assert.equal(requested.init.method, "POST");
  assert.deepEqual(JSON.parse(requested.init.body), {
    displayName: "Иван Иванов",
    phone: "+7 999 111-22-33",
    preferredContactChannel: "phone",
  });
  assert.equal(
    requested.init.headers["Idempotency-Key"],
    "representative-create-1",
  );
  assert.deepEqual(signedInput.tags.slice(0, 2), [
    ["u", expectedUrl],
    ["method", "POST"],
  ]);
});

test("child creation normalizes its note and signs its POST collection resource", async () => {
  let requested;
  let signedInput;
  const service = new HttpStaffFamilyCommandService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({
          childId: CHILD_ID,
          hasPendingDuplicate: false,
          replayed: false,
        }),
      );
    },
  });
  await service.addChild({
    familyId: FAMILY_ID,
    displayName: "  Пётр  ",
    birthDate: "2020-03-02",
    note: "  Нужна адаптация  ",
    idempotencyKey: "child-create-1",
  });
  const expectedUrl = `https://center.example/api/airhop/staff/v1/families/${FAMILY_ID}/children`;
  assert.equal(requested.url, expectedUrl);
  assert.equal(requested.init.method, "POST");
  assert.deepEqual(JSON.parse(requested.init.body), {
    displayName: "Пётр",
    birthDate: "2020-03-02",
    note: "Нужна адаптация",
  });
  assert.deepEqual(signedInput.tags.slice(0, 2), [
    ["u", expectedUrl],
    ["method", "POST"],
  ]);
});

test("representative lifecycle signs its exact status resource", async () => {
  let requested;
  let signedInput;
  const service = new HttpStaffFamilyCommandService({
    relayHttpUrl: async () => "https://center.example/",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({
          representativeId: REPRESENTATIVE_ID,
          status: "archived",
          version: 4,
          hasPendingDuplicate: false,
          replayed: false,
        }),
      );
    },
  });
  await service.setRepresentativeStatus({
    familyId: FAMILY_ID,
    representativeId: REPRESENTATIVE_ID,
    expectedVersion: 3,
    status: "archived",
    idempotencyKey: "representative-status-1",
  });
  const expectedUrl = `https://center.example/api/airhop/staff/v1/families/${FAMILY_ID}/representatives/${REPRESENTATIVE_ID}/status`;
  assert.equal(requested.url, expectedUrl);
  assert.equal(requested.init.method, "PUT");
  assert.deepEqual(JSON.parse(requested.init.body), {
    expectedVersion: 3,
    status: "archived",
  });
  assert.deepEqual(signedInput.tags.slice(0, 2), [
    ["u", expectedUrl],
    ["method", "PUT"],
  ]);
});

test("child lifecycle preserves commitment conflict details", async () => {
  const service = new HttpStaffFamilyCommandService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async () =>
      new Response(
        JSON.stringify({
          error: "Family member has active enrollment or future bookings",
        }),
        { status: 409 },
      ),
  });
  await assert.rejects(
    service.setChildStatus({
      familyId: FAMILY_ID,
      childId: CHILD_ID,
      expectedVersion: 5,
      status: "archived",
    }),
    (error) =>
      error instanceof StaffFamilyCommandApiError &&
      error.status === 409 &&
      error.message ===
        "Family member has active enrollment or future bookings",
  );
});

test("primary representative reassignment signs the family edge resource", async () => {
  let requested;
  let signedInput;
  const service = new HttpStaffFamilyCommandService({
    relayHttpUrl: async () => "https://center.example/",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({
          familyId: FAMILY_ID,
          representativeId: REPRESENTATIVE_ID,
          previousRepresentativeId: "550e8400-e29b-41d4-a716-446655440004",
          version: 6,
          replayed: false,
        }),
      );
    },
  });
  await service.setPrimaryRepresentative({
    familyId: FAMILY_ID,
    representativeId: REPRESENTATIVE_ID,
    expectedVersion: 5,
    idempotencyKey: "primary-representative-1",
  });
  const expectedUrl = `https://center.example/api/airhop/staff/v1/families/${FAMILY_ID}/primary-representative`;
  assert.equal(requested.url, expectedUrl);
  assert.equal(requested.init.method, "PUT");
  assert.deepEqual(JSON.parse(requested.init.body), {
    expectedVersion: 5,
    representativeId: REPRESENTATIVE_ID,
  });
  assert.equal(
    requested.init.headers["Idempotency-Key"],
    "primary-representative-1",
  );
  assert.deepEqual(signedInput.tags.slice(0, 2), [
    ["u", expectedUrl],
    ["method", "PUT"],
  ]);
});
