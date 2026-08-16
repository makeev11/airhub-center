import assert from "node:assert/strict";
import test from "node:test";

import {
  hashRouterPathname,
  isPublicBookingPath,
} from "./publicBookingRoute.ts";

test("public booking routes stay outside the employee shell", () => {
  assert.equal(isPublicBookingPath("/booking"), true);
  assert.equal(isPublicBookingPath("/booking/"), true);
  assert.equal(isPublicBookingPath("/booking/demo-host"), true);
  assert.equal(
    isPublicBookingPath("/booking/manage/opaque-management-token"),
    true,
  );
  assert.equal(isPublicBookingPath("/booking/schedule"), false);
  assert.equal(isPublicBookingPath("/booking/groups"), false);
  assert.equal(isPublicBookingPath("/booking/manage/token/extra"), false);
});

test("hash route parsing preserves only the pathname", () => {
  assert.equal(hashRouterPathname("#/booking?branchId=kurskaya"), "/booking");
  assert.equal(hashRouterPathname("booking/demo-host"), "/booking/demo-host");
  assert.equal(hashRouterPathname(""), "/");
});
