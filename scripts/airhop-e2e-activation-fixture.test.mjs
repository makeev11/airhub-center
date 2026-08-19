import assert from "node:assert/strict";
import test from "node:test";

import {
  AIRHOP_E2E_ACTIVATION_CODE,
  activationCodeDigestHex,
} from "./airhop-e2e-activation-fixture.mjs";

const relaySecret = "00".repeat(31) + "01";

test("fixture exposes a canonical owner activation code", () => {
  assert.match(AIRHOP_E2E_ACTIVATION_CODE, /^ahc_1_[A-Za-z0-9_-]{43}$/);
});

test("activation digest is deterministic and tenant scoped", () => {
  const first = activationCodeDigestHex(
    relaySecret,
    "00000000-0000-4000-8000-000000000001",
    AIRHOP_E2E_ACTIVATION_CODE,
  );
  const replay = activationCodeDigestHex(
    relaySecret,
    "00000000-0000-4000-8000-000000000001",
    AIRHOP_E2E_ACTIVATION_CODE,
  );
  const otherTenant = activationCodeDigestHex(
    relaySecret,
    "00000000-0000-4000-8000-000000000002",
    AIRHOP_E2E_ACTIVATION_CODE,
  );
  assert.equal(first, replay);
  assert.notEqual(first, otherTenant);
  assert.match(first, /^[0-9a-f]{64}$/);
});
