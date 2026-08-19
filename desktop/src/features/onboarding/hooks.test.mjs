import assert from "node:assert/strict";
import test from "node:test";

import {
  provisionWelcomeTeamAfterObserverReady,
  welcomeProvisioningEligibility,
} from "./hooks.ts";

test("only an authoritative claimed owner provisions and focuses Welcome", () => {
  assert.deepEqual(
    welcomeProvisioningEligibility({
      snapshotFound: true,
      membershipRequired: true,
      membership: { role: "owner" },
    }),
    { provisionWelcome: true, focusWelcome: true },
  );
  assert.deepEqual(
    welcomeProvisioningEligibility({
      snapshotFound: true,
      membershipRequired: true,
      membership: { role: "member" },
    }),
    { provisionWelcome: false, focusWelcome: false },
  );
});

test("missing or unsettled membership never guesses owner authority", () => {
  assert.deepEqual(welcomeProvisioningEligibility(undefined), {
    provisionWelcome: false,
    focusWelcome: false,
  });
  assert.deepEqual(
    welcomeProvisioningEligibility({
      snapshotFound: false,
      membershipRequired: true,
      membership: null,
    }),
    { provisionWelcome: false, focusWelcome: false },
  );
});

test("Welcome opens the owner observer subscription before agent runtimes start", async () => {
  const calls = [];
  const result = await provisionWelcomeTeamAfterObserverReady(
    async () => {
      calls.push("observer");
    },
    async () => {
      calls.push("team");
      return "ready";
    },
  );

  assert.equal(result, "ready");
  assert.deepEqual(calls, ["observer", "team"]);
});
