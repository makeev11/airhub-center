import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEMO_BOOKING_STORAGE_KEY,
  createInitialDemoBookingWorkspace,
  demoBookingStorageKey,
  migrateLegacyPreviewStorage,
} from "./demoBookingRepository.ts";
import { DEMO_BOOKING_WORKSPACE } from "../model/demoSchedule.ts";

test("demo booking preview storage is scoped to a Buzz community", () => {
  assert.equal(demoBookingStorageKey(), DEMO_BOOKING_STORAGE_KEY);
  assert.equal(
    demoBookingStorageKey("community:a/b"),
    `${DEMO_BOOKING_STORAGE_KEY}:community%3Aa%2Fb`,
  );
  assert.notEqual(
    demoBookingStorageKey("community-a"),
    demoBookingStorageKey("community-b"),
  );
});

test("demo booking preview adopts the matching v5 scoped workspace once", () => {
  const values = new Map([
    ["buzz-airhop.booking.workspace.v5:community-a", '{"schemaVersion":5}'],
  ]);
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
  const nextKey = demoBookingStorageKey("community-a");

  migrateLegacyPreviewStorage(storage, nextKey, "community-a");

  assert.equal(values.get(nextKey), '{"schemaVersion":5}');
  assert.equal(
    values.has("buzz-airhop.booking.workspace.v5:community-a"),
    false,
  );

  values.set("buzz-airhop.booking.workspace.v5:community-a", "stale");
  migrateLegacyPreviewStorage(storage, nextKey, "community-a");
  assert.equal(values.get(nextKey), '{"schemaVersion":5}');
});

test("a new demo workspace uses the detected time zone without mutating the template", () => {
  const initial = createInitialDemoBookingWorkspace("Asia/Tokyo");

  assert.equal(initial.organization.timeZone, "Asia/Tokyo");
  assert.equal(DEMO_BOOKING_WORKSPACE.organization.timeZone, "Europe/Moscow");
});
