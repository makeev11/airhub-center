import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBranchPublicBookingUrl,
  buildBranchPublicBookingUrlForLocation,
  publicBookingRoutingMode,
} from "./publicBookingLink.ts";

test("branch booking links use the current hash demo origin without carrying admin search", () => {
  const location = {
    origin: "http://127.0.0.1:1420",
    hash: "#/booking/branches",
  };

  assert.equal(publicBookingRoutingMode(location), "hash");
  assert.equal(
    buildBranchPublicBookingUrlForLocation(location, "kurskaya"),
    "http://127.0.0.1:1420/#/booking?branchId=kurskaya",
  );
});

test("production history links stay on the organization's origin", () => {
  assert.equal(
    buildBranchPublicBookingUrl({
      branchId: "center north",
      origin: "https://center.ru/settings?tab=branches",
      routingMode: "history",
    }),
    "https://center.ru/booking?branchId=center+north",
  );
});
