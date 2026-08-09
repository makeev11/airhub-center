import assert from "node:assert/strict";
import test from "node:test";

import {
  AUTO_BOOKING_TIME_ZONE_VALUE,
  bookingTimeZoneOptions,
  detectBookingTimeZone,
} from "./bookingTimeZones.ts";

test("booking time zone detection accepts IANA zones and falls back to Moscow", () => {
  assert.equal(detectBookingTimeZone(() => "Asia/Tokyo"), "Asia/Tokyo");
  assert.equal(detectBookingTimeZone(() => "Mars/Olympus"), "Europe/Moscow");
  assert.equal(detectBookingTimeZone(() => undefined), "Europe/Moscow");
  assert.equal(
    detectBookingTimeZone(() => {
      throw new Error("Intl unavailable");
    }),
    "Europe/Moscow",
  );
});

test("booking time zone options are valid, unique, sorted and keep the current zone", () => {
  assert.deepEqual(
    bookingTimeZoneOptions("America/New_York", [
      "Asia/Tokyo",
      "Mars/Olympus",
      "Asia/Tokyo",
    ]),
    ["America/New_York", "Asia/Tokyo", "Europe/Moscow", "UTC"],
  );
  assert.equal(
    bookingTimeZoneOptions("Europe/Moscow", []).includes(
      AUTO_BOOKING_TIME_ZONE_VALUE,
    ),
    false,
  );
});
