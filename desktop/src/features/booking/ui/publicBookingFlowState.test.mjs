import assert from "node:assert/strict";
import test from "node:test";

import { resolvePublicInitialContext } from "./publicBookingFlowState.ts";

const ACTIVE_BRANCH_IDS = ["kurskaya", "akademicheskaya"];

test("branch-only context is a valid partial preselection", () => {
  assert.deepEqual(
    resolvePublicInitialContext(
      { branchId: "kurskaya" },
      ACTIVE_BRANCH_IDS,
      "2026-08-04",
    ),
    {
      attributionBranchId: "kurskaya",
      ageYears: "",
      branchId: "kurskaya",
      canLoadOccurrences: false,
      contextFallback: false,
      groupId: "",
    },
  );
});

test("under-one age is a valid explicit preselection", () => {
  assert.deepEqual(
    resolvePublicInitialContext(
      { branchId: "kurskaya", ageYears: 0 },
      ACTIVE_BRANCH_IDS,
      "2026-08-04",
    ),
    {
      attributionBranchId: "kurskaya",
      ageYears: "0",
      branchId: "kurskaya",
      canLoadOccurrences: true,
      contextFallback: false,
      groupId: "",
    },
  );
});

test("complete branch, birth month and group context can load occurrences", () => {
  assert.deepEqual(
    resolvePublicInitialContext(
      {
        branchId: "kurskaya",
        birthYear: 2020,
        birthMonth: 8,
        groupId: "robotics-junior",
      },
      ACTIVE_BRANCH_IDS,
      "2026-08-04",
    ),
    {
      attributionBranchId: "kurskaya",
      ageYears: "5",
      branchId: "kurskaya",
      canLoadOccurrences: true,
      contextFallback: false,
      groupId: "robotics-junior",
    },
  );
});

test("an unknown or archived branch falls back without discarding valid age", () => {
  assert.deepEqual(
    resolvePublicInitialContext(
      { branchId: "archived", birthYear: 2020, birthMonth: 8 },
      ACTIVE_BRANCH_IDS,
      "2026-08-04",
    ),
    {
      ageYears: "5",
      branchId: "",
      canLoadOccurrences: false,
      contextFallback: true,
      groupId: "",
    },
  );
});
