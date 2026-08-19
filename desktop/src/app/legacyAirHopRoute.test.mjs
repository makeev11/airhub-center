import assert from "node:assert/strict";
import test from "node:test";

import { resolveLegacyAirHopRoute } from "./legacyAirHopRoute.ts";

test("known BAS-only routes return to the AirHop schedule", () => {
  for (const pathname of [
    "/pulse",
    "/pulse/activity",
    "/projects",
    "/projects/project-123",
    "/workflows",
    "/workflows/workflow-123",
  ]) {
    assert.equal(resolveLegacyAirHopRoute(pathname), "/booking/schedule");
  }
});

test("ordinary AirHop routes keep their normal routing behavior", () => {
  assert.equal(resolveLegacyAirHopRoute("/booking/schedule"), null);
  assert.equal(resolveLegacyAirHopRoute("/agents"), null);
  assert.equal(resolveLegacyAirHopRoute("/knowledge"), "/booking/schedule");
  assert.equal(resolveLegacyAirHopRoute("/channels/general"), null);
  assert.equal(resolveLegacyAirHopRoute("/unknown"), "/booking/schedule");
});
