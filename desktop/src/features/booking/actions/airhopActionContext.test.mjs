import assert from "node:assert/strict";
import test from "node:test";

import { createStaffActionContext, sha256Hex } from "./airhopActionContext.ts";

test("staff action context supplies stable SHA-256 digests and fresh identifiers", () => {
  const ids = ["idempotency-id", "entity-1", "entity-2"];
  const context = createStaffActionContext("2026-08-05T15:00:00.000Z", () =>
    ids.shift(),
  );

  assert.equal(context.now, "2026-08-05T15:00:00.000Z");
  assert.equal(context.idempotencyKey, "staff-ui:idempotency-id");
  assert.equal(context.idFactory(), "entity-1");
  assert.equal(context.idFactory(), "entity-2");
  assert.equal(
    context.digest("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(sha256Hex("abc"), context.digest("abc"));
});
