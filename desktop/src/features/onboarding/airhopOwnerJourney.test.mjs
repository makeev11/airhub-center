import assert from "node:assert/strict";
import test from "node:test";

import {
  shouldEnterWelcomeAfterOwnerProfile,
  shouldUseAirHopOwnerFirstRunSurface,
} from "./airhopOwnerJourney.ts";

test("first community uses the restored AirHop owner surface", () => {
  assert.equal(shouldUseAirHopOwnerFirstRunSurface("first-community"), true);
});

test("first owner enters Welcome immediately after saving the profile", () => {
  assert.equal(shouldEnterWelcomeAfterOwnerProfile("first-community"), true);
});

test("secondary onboarding sources keep their existing team step", () => {
  for (const source of [
    "add-community",
    "membership-recovery",
    "deep-link-connect",
    "deep-link-join",
  ]) {
    assert.equal(shouldUseAirHopOwnerFirstRunSurface(source), false);
    assert.equal(shouldEnterWelcomeAfterOwnerProfile(source), false);
  }
});
