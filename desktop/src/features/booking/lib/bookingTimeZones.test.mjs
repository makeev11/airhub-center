import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_BOOKING_TIME_ZONE_VALUE,
  bookingTimeZoneOptions,
  detectBookingTimeZone,
} from "./bookingTimeZones.ts";

test("booking time zone detection accepts IANA zones and falls back to Moscow", () => {
  assert.equal(
    detectBookingTimeZone(() => "Asia/Tokyo"),
    "Asia/Tokyo",
  );
  assert.equal(
    detectBookingTimeZone(() => "Mars/Olympus"),
    "Europe/Moscow",
  );
  assert.equal(
    detectBookingTimeZone(() => undefined),
    "Europe/Moscow",
  );
  assert.equal(
    detectBookingTimeZone(() => {
      throw new Error("Intl unavailable");
    }),
    "Europe/Moscow",
  );
});

test("booking time zone options are valid, unique, sorted and keep the current zone", () => {
  const expected = [
    ...new Set([
      "America/New_York",
      "Asia/Tokyo",
      detectBookingTimeZone(),
      "Europe/Moscow",
      "UTC",
    ]),
  ].sort((left, right) => left.localeCompare(right, "en"));
  assert.deepEqual(
    bookingTimeZoneOptions("America/New_York", [
      "Asia/Tokyo",
      "Mars/Olympus",
      "Asia/Tokyo",
    ]),
    expected,
  );
  assert.equal(
    bookingTimeZoneOptions("Europe/Moscow", []).includes(
      AUTO_BOOKING_TIME_ZONE_VALUE,
    ),
    false,
  );
});
