import assert from "node:assert/strict";
import test from "node:test";
import {
  groupAgeYears,
  groupAgeMonths,
  hasPreciseLegacyAge,
} from "./groupAgeYears.ts";
test("3–6 completed years maps to 36–83 months", () => {
  assert.equal(groupAgeYears(36), "3");
  assert.equal(groupAgeYears(83), "6");
  assert.equal(groupAgeMonths("3", false), 36);
  assert.equal(groupAgeMonths("6", true), 83);
});
test("empty and zero boundaries remain distinct", () => {
  assert.equal(groupAgeYears(undefined), "");
  assert.equal(groupAgeMonths("", false, 36), undefined);
  assert.equal(groupAgeMonths("0", false), 0);
  assert.equal(groupAgeMonths("0", true), 11);
});
test("editing unrelated fields preserves exact legacy month limits", () => {
  assert.equal(groupAgeMonths("3", false, 42), 42);
  assert.equal(groupAgeMonths("6", true, 72), 72);
  assert.equal(groupAgeMonths("7", true, 72), 95);
  assert.equal(hasPreciseLegacyAge(72, true), true);
  assert.equal(hasPreciseLegacyAge(83, true), false);
});
test("invalid year input is rejected instead of rounded", () => {
  for (const value of ["-1", "3.5", "bad", "1e2", "999999999999999999"]) {
    assert.ok(Number.isNaN(groupAgeMonths(value, true)));
  }
});
