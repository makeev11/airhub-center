import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPublicOccurrenceDateTime,
  formatPublicTrialPolicy,
  getPublicBookingMessages,
} from "./publicBookingLocale.ts";

test("public booking copy uses Russian product branding and organization context", () => {
  const messages = getPublicBookingMessages("ru-RU");
  assert.equal(messages.brand, "Airhop");
  assert.equal(messages.poweredByBrand, "Работает на Airhop");
  assert.equal(messages.ageYears(0), "Меньше года");
  assert.equal(messages.ageYears(1), "1 год");
  assert.equal(messages.ageYears(2), "2 года");
  assert.equal(messages.ageYears(5), "5 лет");
  assert.equal(messages.ageYears(11), "11 лет");
  assert.equal(messages.loadErrorTitle, "Онлайн-запись пока недоступна");
  assert.equal(
    messages.standaloneEyebrow("Каляка Маляка"),
    "Онлайн-запись · Каляка Маляка",
  );
});

test("public occurrence label includes a localized weekday, date and time", () => {
  assert.equal(
    formatPublicOccurrenceDateTime(
      {
        date: "2026-08-10",
        startTime: "18:30",
        endTime: "20:00",
      },
      "ru-RU",
    ),
    "Понедельник, 10 августа · 18:30–20:00",
  );
});

test("public trial copy distinguishes free, paid and disabled policies", () => {
  const messages = getPublicBookingMessages("ru-RU");
  assert.equal(
    formatPublicTrialPolicy({ mode: "free" }, "ru-RU", messages),
    "Бесплатно",
  );
  assert.match(
    formatPublicTrialPolicy(
      {
        mode: "paid",
        price: { amountMinor: 90_000, currency: "RUB" },
      },
      "ru-RU",
      messages,
    ),
    /^Стоимость:/,
  );
  assert.equal(
    formatPublicTrialPolicy({ mode: "disabled" }, "ru-RU", messages),
    "Пробное недоступно",
  );
});
