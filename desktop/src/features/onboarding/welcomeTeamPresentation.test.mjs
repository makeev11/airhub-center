import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { WELCOME_TEAM_PRESENTATIONS } from "./welcomeTeamPresentation.ts";

test("Welcome setup presents the four Airhop roles with their assigned characters", () => {
  assert.deepEqual(WELCOME_TEAM_PRESENTATIONS, [
    {
      role: "fizz",
      animationUrl: "/agents/fizz.png",
    },
    {
      role: "administrator",
      animationUrl: "/agents/administrator.png",
    },
    {
      role: "analyst",
      animationUrl: "/agents/analyst.png",
    },
    {
      role: "content_marketer",
      animationUrl: "/agents/editor.png",
    },
  ]);
});

test("the native starter-team screen uses the same four product roles", () => {
  const flow = readFileSync(
    new URL("./ui/CommunityOnboardingFlow.tsx", import.meta.url),
    "utf8",
  );

  assert.match(flow, /WELCOME_TEAM_PRESENTATIONS\.map/);
  assert.doesNotMatch(
    flow,
    /\["Fizz", "Honey", "Bumble"\]/,
    "the old character trio is not the Airhop product team",
  );
});
