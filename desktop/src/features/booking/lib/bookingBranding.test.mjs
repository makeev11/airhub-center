import assert from "node:assert/strict";
import test from "node:test";
import { getBookingAdminMessages } from "./bookingAdminLocale.ts";

test("booking labels do not expose upstream product or persona names", () => {
  for (const locale of ["ru-RU", "en-US"]) {
    const messages = getBookingAdminMessages(locale);
    for (const key of [
      "teacherBuzzUsername",
      "buzzChannelSearching",
      "paymentsBuzzChannel",
      "paymentsBuzzChannelHint",
      "analyticsBuzzChannel",
      "analyticsBuzzChannelHint",
    ]) {
      assert.equal(typeof messages[key], "string", key);
      assert.doesNotMatch(messages[key], /Buzz|Fizz|Физ|Bumble|Honey/i, key);
    }
  }
});
