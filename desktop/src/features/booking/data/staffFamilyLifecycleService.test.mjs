import assert from "node:assert/strict";
import test from "node:test";

import {
  HttpStaffFamilyLifecycleService,
  StaffFamilyLifecycleApiError,
} from "./staffFamilyLifecycleService.ts";

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

function createInput() {
  return {
    displayName: "  Семья Ивановых  ",
    representativeName: "  Мария Иванова  ",
    representativeFirstName: "  Мария  ",
    representativeLastName: "  Иванова  ",
    phone: "  +7 999 123-45-67  ",
    childName: "  Анна  ",
    childFirstName: "  Анна  ",
    childLastName: "  Иванова  ",
    childBirthDate: "2019-05-20",
    childNote: "  Аллергия на орехи  ",
    idempotencyKey: "family-create-1",
  };
}

test("family creation signs the exact POST payload and URL", async () => {
  let signedInput;
  let requested;
  const service = new HttpStaffFamilyLifecycleService({
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
          childId: CHILD_ID,
          hasPendingDuplicate: true,
          replayed: false,
        }),
      );
    },
  });

  const outcome = await service.createFamily(createInput());
  const expectedUrl = "https://center.example/api/airhop/staff/v1/families";
  const expectedBody = JSON.stringify({
    displayName: "Семья Ивановых",
    representativeName: "Мария Иванова",
    representativeFirstName: "Мария",
    representativeLastName: "Иванова",
    phone: "+7 999 123-45-67",
    preferredContactChannel: "phone",
    childName: "Анна",
    childFirstName: "Анна",
    childLastName: "Иванова",
    childBirthDate: "2019-05-20",
    childNote: "Аллергия на орехи",
  });
  assert.equal(requested.url, expectedUrl);
  assert.equal(requested.init.method, "POST");
  assert.equal(requested.init.body, expectedBody);
  assert.equal(requested.init.headers["Idempotency-Key"], "family-create-1");
  assert.deepEqual(signedInput.tags.slice(0, 2), [
    ["u", expectedUrl],
    ["method", "POST"],
  ]);
  assert.equal(signedInput.tags[2][0], "payload");
  assert.equal(signedInput.tags[2][1].length, 64);
  assert.equal(outcome.hasPendingDuplicate, true);
});

test("family status signs the exact PUT resource and version", async () => {
  let signedInput;
  let requested;
  const service = new HttpStaffFamilyLifecycleService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => {
      signedInput = input;
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requested = { url, init };
      return new Response(
        JSON.stringify({
          familyId: FAMILY_ID,
          status: "archived",
          version: 3,
          replayed: false,
        }),
      );
    },
  });

  const outcome = await service.setFamilyStatus({
    familyId: FAMILY_ID,
    expectedVersion: 2,
    status: "archived",
    idempotencyKey: "family-archive-1",
  });
  const expectedUrl = `https://center.example/api/airhop/staff/v1/families/${FAMILY_ID}/status`;
  assert.equal(requested.url, expectedUrl);
  assert.equal(requested.init.method, "PUT");
  assert.deepEqual(JSON.parse(requested.init.body), {
    expectedVersion: 2,
    status: "archived",
  });
  assert.deepEqual(signedInput.tags.slice(0, 2), [
    ["u", expectedUrl],
    ["method", "PUT"],
  ]);
  assert.equal(outcome.version, 3);
});

test("family creation validates fields before signing or fetching", async () => {
  let signed = false;
  let fetched = false;
  const service = new HttpStaffFamilyLifecycleService({
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
    service.createFamily({ ...createInput(), childBirthDate: "20.05.2019" }),
    (error) =>
      error instanceof StaffFamilyLifecycleApiError && error.status === 400,
  );
  assert.equal(signed, false);
  assert.equal(fetched, false);
});

test("family status preserves optimistic conflict details", async () => {
  const service = new HttpStaffFamilyLifecycleService({
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
    service.setFamilyStatus({
      familyId: FAMILY_ID,
      expectedVersion: 2,
      status: "archived",
    }),
    (error) =>
      error instanceof StaffFamilyLifecycleApiError &&
      error.status === 409 &&
      error.message === "AirHub entity changed; reload before saving",
  );
});
