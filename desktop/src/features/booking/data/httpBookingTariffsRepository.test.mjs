import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { HttpBookingTariffsRepository } from "./httpBookingTariffsRepository.ts";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TARIFF_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

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

function organization() {
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
  };
}

function tariff(overrides = {}) {
  return {
    id: TARIFF_ID,
    organizationId: ORGANIZATION_ID,
    name: "Два раза в неделю",
    description: "Восемь занятий в месяц",
    priceMinor: 600000,
    currency: "RUB",
    weeklyScheduleLimit: 2,
    paymentDayOfMonth: null,
    status: "active",
    activeEnrollmentCount: 3,
    version: 1,
    createdAt: "2026-08-17T10:00:00Z",
    updatedAt: "2026-08-17T10:00:00Z",
    ...overrides,
  };
}

function directory(items = []) {
  return { organization: organization(), organizationVersion: 4, items };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("tariff repository creates a server-owned tariff and reloads usage", async () => {
  const requests = [];
  const signedInputs = [];
  let getCount = 0;
  const repository = new HttpBookingTariffsRepository({
    relayHttpUrl: async () => "https://center.example/",
    idempotencyKeyFactory: () => "tariff-command-12345",
    nonceFactory: () => `nonce-${requests.length}`,
    signEvent: async (input) => {
      signedInputs.push(input);
      return signedEvent(input);
    },
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (init.method === "GET") {
        getCount += 1;
        return jsonResponse(
          getCount === 1 ? directory() : directory([tariff()]),
        );
      }
      return jsonResponse({ tariffId: TARIFF_ID, version: 1, replayed: false });
    },
  });

  const current = await repository.load();
  const now = "2026-08-17T10:00:00Z";
  const { revision: _revision, ...draft } = current;
  const saved = await repository.save(
    {
      ...draft,
      tariffs: [
        {
          id: "tariff-temporary",
          organizationId: ORGANIZATION_ID,
          name: "Два раза в неделю",
          description: "Восемь занятий в месяц",
          priceMinor: 600000,
          currency: "RUB",
          weeklyScheduleLimit: 2,
          status: "active",
          createdAt: now,
          updatedAt: now,
        },
      ],
    },
    current.revision,
  );

  const post = requests[1];
  assert.equal(post.url, "https://center.example/api/airhop/staff/v1/tariffs");
  assert.equal(post.init.method, "POST");
  assert.equal(post.init.headers["Idempotency-Key"], "tariff-command-12345");
  assert.deepEqual(JSON.parse(post.init.body), {
    name: "Два раза в неделю",
    description: "Восемь занятий в месяц",
    priceMinor: 600000,
    currency: "RUB",
    weeklyScheduleLimit: 2,
    paymentDayOfMonth: null,
  });
  const payloadTag = signedInputs[1].tags.find(([name]) => name === "payload");
  assert.equal(
    payloadTag[1],
    createHash("sha256").update(post.init.body).digest("hex"),
  );
  assert.equal(saved.tariffs[0].id, TARIFF_ID);
  assert.equal(saved.tariffs[0].activeEnrollmentCount, 3);
});
