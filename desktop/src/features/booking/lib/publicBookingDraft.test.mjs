import assert from "node:assert/strict";
import test from "node:test";
import {
  publicBookingDraftKey,
  readPublicBookingDraft,
  writePublicBookingDraft,
} from "./publicBookingDraft.ts";

const draft = {
  step: "contact",
  branchId: "branch-1",
  groupId: "dance",
  ageYears: "4",
  lessonKey: "dance:2026-09-11",
  idempotencyKey: "one-submission",
  managementToken: null,
  applicant: {
    parentName: "Тест",
    parentLastName: "Тестов",
    phone: "+79990000000",
    childName: "Тест",
    childBirthDate: "2022-08-01",
    consentAccepted: true,
  },
};

test("tab draft retains contact data, progress and submission identity across remounts", () => {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const key = publicBookingDraftKey("center-1", "trial", {});
  writePublicBookingDraft(key, draft);
  const restored = readPublicBookingDraft(key);
  assert.deepEqual(restored.applicant, draft.applicant);
  assert.equal(restored.step, "contact");
  assert.equal(restored.idempotencyKey, "one-submission");
  assert.equal(
    readPublicBookingDraft(publicBookingDraftKey("center-2", "trial", {})),
    null,
  );
  assert.equal(
    readPublicBookingDraft(publicBookingDraftKey("center-1", "single", {})),
    null,
  );
  writePublicBookingDraft(key, {
    ...draft,
    managementToken: "saved-booking-token",
  });
  assert.equal(
    readPublicBookingDraft(key).managementToken,
    "saved-booking-token",
  );
});

test("invalid and expired drafts are ignored", () => {
  const values = new Map();
  globalThis.sessionStorage = {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
  };
  values.set("invalid", "not-json");
  values.set("incomplete", JSON.stringify({ step: "preview" }));
  values.set(
    "expired",
    JSON.stringify({ ...draft, savedAt: Date.now() - 25 * 3600 * 1000 }),
  );
  for (const key of values.keys())
    assert.equal(readPublicBookingDraft(key), null);
  assert.equal(values.has("expired"), false);
});

test("storage restrictions never prevent the booking flow", () => {
  globalThis.sessionStorage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };
  assert.equal(readPublicBookingDraft("draft"), null);
  assert.doesNotThrow(() => writePublicBookingDraft("draft", draft));
});

test("tracking parameters and property order do not split the same booking draft", () => {
  assert.equal(
    publicBookingDraftKey("center", "trial", { branchId: "b", ageYears: 4 }),
    publicBookingDraftKey("center", "trial", {
      utm_source: "hygge",
      ageYears: 4,
      branchId: "b",
    }),
  );
});
