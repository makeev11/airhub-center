import assert from "node:assert/strict";
import test from "node:test";

import * as e2eBridge from "./e2eBridge.ts";

test("mock random UUID works when Web Crypto is unavailable over a LAN URL", () => {
  assert.equal(typeof e2eBridge.mockRandomUuid, "function");

  const originalDescriptor = Object.getOwnPropertyDescriptor(
    globalThis,
    "crypto",
  );
  Object.defineProperty(globalThis, "crypto", {
    configurable: true,
    value: undefined,
  });

  try {
    assert.match(
      e2eBridge.mockRandomUuid(),
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  } finally {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, "crypto", originalDescriptor);
    } else {
      delete globalThis.crypto;
    }
  }
});
