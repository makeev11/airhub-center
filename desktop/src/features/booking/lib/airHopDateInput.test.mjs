import assert from "node:assert/strict";
import test from "node:test";

import {
  airHopDateToIso,
  airHopTodayIsoDate,
  formatAirHopDateInput,
  isAirHopDateInRange,
  maskAirHopDateInput,
  parseAirHopDateInput,
  parseAirHopIsoDate,
} from "./airHopDateInput.ts";

test("AirHop date input converts between visible and storage formats", () => {
  assert.equal(formatAirHopDateInput("2021-09-01"), "01.09.2021");
  assert.equal(
    airHopTodayIsoDate(new Date(2026, 7, 11, 12, 0, 0)),
    "2026-08-11",
  );
  assert.equal(parseAirHopDateInput("01.09.2021"), "2021-09-01");
  assert.deepEqual(parseAirHopIsoDate("2024-02-29"), {
    day: 29,
    month: 2,
    year: 2024,
  });
});

test("AirHop date input masks digits and rejects impossible dates", () => {
  assert.equal(maskAirHopDateInput("11082026"), "11.08.2026");
  assert.equal(maskAirHopDateInput("11-08-2026"), "11.08.2026");
  assert.equal(parseAirHopDateInput("31.02.2026"), null);
  assert.equal(parseAirHopIsoDate("2023-02-29"), null);
  assert.equal(airHopDateToIso({ day: 31, month: 4, year: 2026 }), null);
});

test("AirHop date input respects optional bounds", () => {
  assert.equal(isAirHopDateInRange("2026-08-11", "2026-08-01"), true);
  assert.equal(isAirHopDateInRange("2026-07-31", "2026-08-01"), false);
  assert.equal(
    isAirHopDateInRange("2026-09-01", undefined, "2026-08-31"),
    false,
  );
});
