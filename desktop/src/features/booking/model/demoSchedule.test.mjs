import assert from "node:assert/strict";
import test from "node:test";

import {
  DEMO_BRANCHES,
  getAvailablePlaces,
  getDemoWeek,
} from "./demoSchedule.ts";

test("AirHop demo covers the schedule states used by the first UI slice", () => {
  const { lessons } = getDemoWeek();

  assert.equal(DEMO_BRANCHES.length, 2);
  assert.ok(lessons.length >= 12);
  assert.ok(lessons.some((lesson) => lesson.capacity === undefined));
  assert.ok(lessons.some((lesson) => getAvailablePlaces(lesson) === 1));
  assert.ok(lessons.some((lesson) => getAvailablePlaces(lesson) === 0));
  assert.ok(lessons.some((lesson) => lesson.trial.mode === "free"));
  assert.ok(lessons.some((lesson) => lesson.trial.mode === "paid"));
  assert.ok(lessons.some((lesson) => !lesson.teachers?.length));
  assert.ok(lessons.some((lesson) => lesson.teachers?.length === 1));
  assert.ok(lessons.some((lesson) => (lesson.teachers?.length ?? 0) > 1));
  assert.ok(lessons.some((lesson) => !lesson.room));
  assert.ok(lessons.some((lesson) => lesson.status === "moved"));
  assert.ok(lessons.some((lesson) => lesson.status === "cancelled"));
});

test("AirHop demo moves the deterministic pattern by complete weeks", () => {
  const current = getDemoWeek(0);
  const following = getDemoWeek(1);

  assert.equal(current.startDate, "2026-08-10");
  assert.equal(following.startDate, "2026-08-17");
  assert.equal(current.lessons[0].groupName, following.lessons[0].groupName);
  assert.notEqual(current.lessons[0].id, following.lessons[0].id);
});
