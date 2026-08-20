import assert from "node:assert/strict";
import test from "node:test";

import {
  HttpStaffFamilyDirectoryService,
  StaffFamilyDirectoryApiError,
} from "./staffFamilyDirectoryService.ts";

const IDS = {
  family: "550e8400-e29b-41d4-a716-446655440001",
  representative: "550e8400-e29b-41d4-a716-446655440002",
  child: "550e8400-e29b-41d4-a716-446655440003",
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
        id: IDS.family,
        displayName: "Семья Ивановых",
        status: "active",
        updatedAt: "2026-08-16T08:00:00Z",
        primaryRepresentative: {
          id: IDS.representative,
          displayName: "Мария Иванова",
          firstName: "Мария",
          lastName: "Иванова",
          phoneNormalized: "+79991234567",
          phoneDisplay: "+7 999 123-45-67",
          preferredContactChannel: "telegram",
        },
        children: [
          {
            id: IDS.child,
            displayName: "Анна",
            firstName: "Анна",
            lastName: "Петрова",
            status: "active",
          },
        ],
        bookingCount: 2,
        activeEnrollmentCount: 1,
        hasPendingDuplicate: false,
      },
    ],
    nextCursor: {
      sortName: "семья ивановых",
      familyId: IDS.family,
    },
  };
}

test("family directory signs the exact filtered GET URL", async () => {
  let signedInput;
  let requested;
  const service = new HttpStaffFamilyDirectoryService({
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

  const page = await service.listFamilies({
    status: "active",
    search: "  Мария  ",
    limit: 25,
  });

  const expectedUrl =
    "https://center.example/api/airhop/staff/v1/families?status=active&search=%D0%9C%D0%B0%D1%80%D0%B8%D1%8F&limit=25";
  assert.equal(requested.url, expectedUrl);
  assert.equal(requested.init.method, "GET");
  assert.deepEqual(signedInput.tags.slice(0, 2), [
    ["u", expectedUrl],
    ["method", "GET"],
  ]);
  assert.equal(
    page.items[0].primaryRepresentative.displayName,
    "Мария Иванова",
  );
});

test("family directory sends both keyset cursor components", async () => {
  let requestedUrl;
  const service = new HttpStaffFamilyDirectoryService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async (url) => {
      requestedUrl = url;
      return new Response(JSON.stringify({ items: [], nextCursor: null }));
    },
  });
  await service.listFamilies({ cursor: validPage().nextCursor });
  const parsed = new URL(requestedUrl);
  assert.equal(parsed.searchParams.get("cursorSortName"), "семья ивановых");
  assert.equal(parsed.searchParams.get("cursorFamilyId"), IDS.family);
});

test("family directory validates input before signing or fetching", async () => {
  let signed = false;
  let fetched = false;
  const service = new HttpStaffFamilyDirectoryService({
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
    service.listFamilies({ limit: 101 }),
    (error) =>
      error instanceof StaffFamilyDirectoryApiError && error.status === 400,
  );
  assert.equal(signed, false);
  assert.equal(fetched, false);
});

test("family directory exposes server errors and strips undeclared child data", async () => {
  const forbidden = new HttpStaffFamilyDirectoryService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async () =>
      new Response(JSON.stringify({ error: "membership required" }), {
        status: 403,
      }),
  });
  await assert.rejects(
    forbidden.listFamilies(),
    (error) =>
      error instanceof StaffFamilyDirectoryApiError &&
      error.status === 403 &&
      error.message === "membership required",
  );

  const malformed = validPage();
  malformed.items[0].children[0].birthDate = "2019-05-20";
  const unsafe = new HttpStaffFamilyDirectoryService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (input) => signedEvent(input),
    fetch: async () => new Response(JSON.stringify(malformed)),
  });
  const parsed = await unsafe.listFamilies();
  assert.equal("birthDate" in parsed.items[0].children[0], false);
});
