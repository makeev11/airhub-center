import assert from "node:assert/strict";
import test from "node:test";

import * as bookingLocale from "./bookingLocale.ts";
import { getBookingAdminMessages } from "./bookingAdminLocale.ts";

const { createBookingFormatters, formatBookingAgeRange, getBookingMessages } =
  bookingLocale;

test("Booking locale keeps Russian as the MVP copy fallback", () => {
  assert.equal(getBookingMessages("ru-RU").scheduleTitle, "Расписание");
  assert.equal(getBookingMessages("tr-TR").scheduleTitle, "Расписание");
});

test("AirHop settings explain automatic time zone detection", () => {
  const messages = getBookingAdminMessages("ru-RU");

  assert.equal(
    messages.timeZoneAutomatic("Asia/Tokyo"),
    "Определить автоматически — Asia/Tokyo",
  );
  assert.equal(
    messages.timeZoneHint,
    "Выберите часовой пояс IANA из списка или определите его автоматически.",
  );
});

test("Booking locale covers lesson overrides and working-hour accessibility", () => {
  const messages = getBookingMessages("ru-RU");
  const adminMessages = getBookingAdminMessages("ru-RU");

  assert.equal(messages.lessonCapacityInherit, "Наследовать от серии");
  assert.equal(messages.lessonTrialInherit, "Наследовать");
  assert.equal(
    messages.lessonChangeCapacity("8 мест", "Без ограничения"),
    "Вместимость: 8 мест → Без ограничения",
  );
  assert.equal(
    messages.lessonChangeTrial("Бесплатно", "Платно"),
    "Пробное: Бесплатно → Платно",
  );
  assert.equal(adminMessages.workingPeriodStart, "начало");
  assert.equal(adminMessages.workingPeriodEnd, "окончание");
  assert.equal(
    adminMessages.bookedOccurrenceRuleErrorTitle,
    "Нельзя изменить эту серию",
  );
  assert.match(
    adminMessages.bookedOccurrenceRuleErrorDescription,
    /уже есть записи/,
  );
});

test("Booking formatters keep the organization's locale and currency", () => {
  const formatter = createBookingFormatters("tr-TR");
  const actual = formatter.money(12_345, "TRY");
  const expected = new Intl.NumberFormat("tr-TR", {
    style: "currency",
    currency: "TRY",
  }).format(123.45);

  assert.equal(actual, expected);
  assert.equal(
    formatter.money(900, "JPY"),
    new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "JPY",
    }).format(900),
  );
  assert.equal(
    formatter.money(1_234, "KWD"),
    new Intl.NumberFormat("tr-TR", {
      style: "currency",
      currency: "KWD",
    }).format(1.234),
  );
  assert.equal(formatter.date("2026-08-03"), "3 Ağustos");
  assert.equal(formatter.weekdayDate("2026-08-03"), "3 Ağustos Pazartesi");
});

test("Booking formatters expose a capitalized localized weekday and date", () => {
  assert.equal(
    createBookingFormatters("ru-RU").weekdayDate("2026-08-10"),
    "Понедельник, 10 августа",
  );
});

test("Booking age formatter does not round month limits down", () => {
  assert.equal(
    formatBookingAgeRange({ locale: "ru-RU", minAgeMonths: 71 }),
    "от 5 лет 11 месяцев",
  );
  assert.equal(
    formatBookingAgeRange({
      locale: "ru-RU",
      minAgeMonths: 60,
      maxAgeMonths: 84,
    }),
    "5–7 лет",
  );
});

test("child age renders completed years next to localized birth date", () => {
  assert.equal(typeof bookingLocale.formatChildAgeAndBirthDate, "function");
  assert.equal(
    bookingLocale.formatChildAgeAndBirthDate({
      birthDate: "2019-03-14",
      onDate: "2026-08-06",
      locale: "ru-RU",
    }),
    "7 лет · 14 марта 2019 г.",
  );
  assert.equal(
    bookingLocale.formatChildAgeAndBirthDate({
      birthDate: "2022-08-07",
      onDate: "2026-08-06",
      locale: "ru-RU",
    }),
    "3 года · 7 августа 2022 г.",
  );
});
