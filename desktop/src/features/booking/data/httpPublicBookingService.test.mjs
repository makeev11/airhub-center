import assert from "node:assert/strict";
import test from "node:test";

import { HttpPublicBookingService } from "./httpPublicBookingService.ts";
import {
  PublicBookingAgeMismatchError,
  PublicBookingTransitionError,
  PublicBookingUnavailableError,
} from "./publicBookingService.ts";

const ORGANIZATION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BRANCH_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const GROUP_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const RULE_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MANAGEMENT_TOKEN = `ahb_1_${"A".repeat(43)}`;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function catalogResponse() {
  return {
    organization: {
      id: ORGANIZATION_ID,
      name: "AirHub Sokol",
      locale: "ru-RU",
      timeZone: "Europe/Moscow",
      currentDate: "2026-08-16",
      publicBooking: {
        purpose: "trial",
        appearance: "automatic",
        consentPolicyVersion: "public-booking-v1",
      },
    },
    branches: [{ id: BRANCH_ID, name: "Сокол", address: "Москва" }],
  };
}

function occurrenceResponse() {
  return {
    lessonRef: {
      recurrenceRuleId: RULE_ID,
      originalDate: "2026-08-20",
    },
    groupId: GROUP_ID,
    groupName: "Football 6–7",
    branchId: BRANCH_ID,
    branchName: "Сокол",
    branchAddress: "Москва",
    teacherNames: ["Анна"],
    date: "2026-08-20",
    startTime: "17:00",
    endTime: "18:00",
    trialPolicy: { mode: "free" },
    capacity: 10,
    occupied: 8,
    remaining: 2,
    available: true,
  };
}

function managementCardResponse(overrides = {}) {
  return {
    status: "pending_confirmation",
    childName: "Лев",
    maskedPhone: "+79 ••• ••• 45 67",
    preferredContactChannel: "none",
    organizationName: "AirHub Sokol",
    branchName: "Сокол",
    branchAddress: "Москва",
    groupName: "Football 6–7",
    teacherNames: ["Анна"],
    date: "2026-08-20",
    startTime: "17:00",
    endTime: "18:00",
    trialPolicy: { mode: "free" },
    purpose: "trial",
    canCancel: true,
    canRequestTransfer: true,
    ...overrides,
  };
}

test("HTTP adapter reads the host-bound catalog and occurrence projection", async () => {
  const requests = [];
  const service = new HttpPublicBookingService({
    basePath: "/public/v1",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/catalog"))
        return jsonResponse(catalogResponse());
      return jsonResponse({ occurrences: [occurrenceResponse()] });
    },
  });

  const catalog = await service.getCatalog();
  const occurrences = await service.findOccurrences({
    branchId: BRANCH_ID,
    ageYears: 6,
    purpose: "trial",
  });

  assert.equal(catalog.organization.name, "AirHub Sokol");
  assert.equal(occurrences[0].remaining, 2);
  assert.equal(
    requests[1].url,
    `/public/v1/occurrences?branchId=${BRANCH_ID}&ageYears=6&purpose=trial`,
  );
  assert.equal(requests[0].init.credentials, "same-origin");
});

test("create uses an idempotent command then loads the card with a bearer token", async () => {
  const requests = [];
  const service = new HttpPublicBookingService({
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (String(url).endsWith("/catalog"))
        return jsonResponse(catalogResponse());
      if (String(url).endsWith("/bookings")) {
        return jsonResponse({ managementToken: MANAGEMENT_TOKEN }, 201);
      }
      return jsonResponse(managementCardResponse());
    },
  });
  await service.getCatalog();

  const result = await service.createBooking({
    lessonRef: {
      recurrenceRuleId: RULE_ID,
      originalDate: "2026-08-20",
    },
    applicant: {
      parentName: "Мария",
      phone: "+7 999 123-45-67",
      childName: "Лев",
      childBirthDate: "2020-08-10",
      consentAccepted: true,
    },
    idempotencyKey: "public-booking-command-0001",
    purpose: "trial",
    source: { surface: "standalone", attributionBranchId: BRANCH_ID },
  });

  const createRequest = requests[1];
  const cardRequest = requests[2];
  assert.equal(result.managementToken, MANAGEMENT_TOKEN);
  assert.equal(result.card.transferRequest, null);
  assert.equal(
    new Headers(createRequest.init.headers).get("Idempotency-Key"),
    "public-booking-command-0001",
  );
  assert.deepEqual(JSON.parse(createRequest.init.body), {
    lessonRef: {
      recurrenceRuleId: RULE_ID,
      originalDate: "2026-08-20",
    },
    applicant: {
      parentName: "Мария",
      phone: "+7 999 123-45-67",
      childName: "Лев",
      childBirthDate: "2020-08-10",
      consentAccepted: true,
      consentPolicyVersion: "public-booking-v1",
    },
    preferredContactChannel: "none",
    source: { surface: "standalone", attributionBranchId: BRANCH_ID },
  });
  assert.equal(
    new Headers(cardRequest.init.headers).get("Authorization"),
    `Bearer ${MANAGEMENT_TOKEN}`,
  );
});

test("stable API errors map to the public flow error contract", async () => {
  for (const [code, ErrorType] of [
    ["capacity_full", PublicBookingUnavailableError],
    ["age_mismatch", PublicBookingAgeMismatchError],
  ]) {
    const service = new HttpPublicBookingService({
      fetch: async (url) => {
        if (String(url).endsWith("/catalog"))
          return jsonResponse(catalogResponse());
        return jsonResponse(
          { error: { code, message: "Rejected", retryable: false } },
          409,
        );
      },
    });
    await service.getCatalog();
    await assert.rejects(
      service.createBooking({
        lessonRef: {
          recurrenceRuleId: RULE_ID,
          originalDate: "2026-08-20",
        },
        applicant: {
          parentName: "Мария",
          phone: "+79991234567",
          childName: "Лев",
          childBirthDate: "2020-08-10",
          consentAccepted: true,
        },
        idempotencyKey: "public-booking-command-0001",
        purpose: "trial",
        source: { surface: "standalone" },
      }),
      ErrorType,
    );
  }
});

test("management actions keep the token in Authorization and map transitions", async () => {
  const requests = [];
  let transitionFailure = false;
  const service = new HttpPublicBookingService({
    idempotencyKeyFactory: () => "management-command-0001",
    fetch: async (url, init) => {
      requests.push({ url: String(url), init });
      if (transitionFailure) {
        return jsonResponse(
          {
            error: {
              code: "booking_transition_invalid",
              message: "Cannot change",
              retryable: false,
            },
          },
          409,
        );
      }
      return jsonResponse(
        managementCardResponse({ status: "cancelled_by_parent" }),
      );
    },
  });

  const card = await service.cancelByParent(MANAGEMENT_TOKEN);
  assert.equal(card.status, "cancelled_by_parent");
  assert.equal(requests[0].url.includes(MANAGEMENT_TOKEN), false);
  assert.equal(
    new Headers(requests[0].init.headers).get("Authorization"),
    `Bearer ${MANAGEMENT_TOKEN}`,
  );
  assert.equal(
    new Headers(requests[0].init.headers).get("Idempotency-Key"),
    "management-command-0001",
  );

  transitionFailure = true;
  await assert.rejects(
    service.requestTransfer(MANAGEMENT_TOKEN, "Нужен вечер"),
    PublicBookingTransitionError,
  );
});

test("malformed management tokens are rejected before any network request", async () => {
  let calls = 0;
  const service = new HttpPublicBookingService({
    fetch: async () => {
      calls += 1;
      return jsonResponse(managementCardResponse());
    },
  });
  assert.equal(await service.getManagementCard("invalid"), null);
  assert.equal(await service.cancelByParent("invalid"), null);
  assert.equal(calls, 0);
});
