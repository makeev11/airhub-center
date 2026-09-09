import assert from "node:assert/strict";
import test from "node:test";
import { publicBookingAgeNotice } from "./publicBookingAgeNotice.ts";

const occurrence = {
  groupName: "Танцы",
  date: "2026-09-11",
  minAgeMonths: 36,
  maxAgeMonths: 71,
};
const notice = (birthDate, age = 4, group = occurrence) =>
  publicBookingAgeNotice(group, birthDate, age, "2026-09-09");

test("recommended ages are quiet and dates outside the range receive a note", () => {
  assert.equal(notice("2022-08-01"), null);
  assert.match(notice("2016-08-01"), /Танцы.*другого возраста/);
  assert.match(notice("2024-08-01"), /другого возраста/);
});

test("selected age gives an early recommendation and exact birthday refines it", () => {
  assert.match(notice("", 10), /другого возраста/);
  assert.equal(notice("2022-08-01", 10), null);
  assert.equal(notice("", 4), null);
});

test("groups without age recommendations never show an age note", () => {
  assert.equal(
    notice("2016-08-01", 10, {
      groupName: "Семейная мастерская",
      date: occurrence.date,
    }),
    null,
  );
});
