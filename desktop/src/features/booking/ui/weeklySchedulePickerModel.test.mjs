import assert from "node:assert/strict";
import test from "node:test";

import { DEMO_BOOKING_WORKSPACE } from "../model/demoSchedule.ts";
import {
  deriveWeeklySlotOptions,
  isWeeklySlotSelectionDisabled,
} from "./weeklySchedulePickerModel.ts";

test("weekly slot options flatten active group rules into ordered day and time choices", () => {
  const workspace = structuredClone(DEMO_BOOKING_WORKSPACE);
  workspace.recurrenceRules.push({
    ...workspace.recurrenceRules.find(
      ({ groupId }) => groupId === "robotics-junior",
    ),
    id: "robotics-junior-evenings",
    weekdays: ["friday", "monday"],
    startTime: "18:00",
    endTime: "19:00",
  });

  const options = deriveWeeklySlotOptions(workspace, "robotics-junior");

  assert.ok(options.length >= 2);
  assert.deepEqual(
    options
      .filter(({ recurrenceRuleId }) =>
        ["robotics-junior-evenings"].includes(recurrenceRuleId),
      )
      .map(({ weekday, startTime }) => [weekday, startTime]),
    [
      ["monday", "18:00"],
      ["friday", "18:00"],
    ],
  );
});

test("weekly slot limit disables only unselected choices", () => {
  const selected = [
    { recurrenceRuleId: "rule-one", weekday: "monday" },
    { recurrenceRuleId: "rule-two", weekday: "wednesday" },
  ];

  assert.equal(
    isWeeklySlotSelectionDisabled(
      { recurrenceRuleId: "rule-three", weekday: "friday" },
      selected,
      2,
    ),
    true,
  );
  assert.equal(isWeeklySlotSelectionDisabled(selected[0], selected, 2), false);
});
