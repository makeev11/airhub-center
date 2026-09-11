import assert from "node:assert/strict";
import test from "node:test";
import { startManagedAgentRuntimesForRelay } from "./tauriManagedAgents.ts";

test("Welcome startup restarts changed environments sequentially and preserves other runtimes", async () => {
  const previousWindow = globalThis.window;
  const calls = [];
  let pending = false;
  globalThis.window = {
    __TAURI_INTERNALS__: {
      invoke: async (command, args) => {
        assert.equal(pending, false);
        pending = true;
        await new Promise((resolve) => setTimeout(resolve, 1));
        calls.push([command, args]);
        pending = false;
        return { pubkey: args.pubkey };
      },
    },
  };
  try {
    await startManagedAgentRuntimesForRelay(
      [
        { pubkey: "changed", relayUrl: "wss://demo.example" },
        { pubkey: "same" },
      ],
      "wss://fallback.example",
      new Set(["changed"]),
    );
    assert.deepEqual(calls, [
      [
        "restart_managed_agent_runtime",
        { pubkey: "changed", relayUrl: "wss://demo.example" },
      ],
      [
        "start_managed_agent_runtime",
        { pubkey: "same", relayUrl: "wss://fallback.example" },
      ],
    ]);
  } finally {
    globalThis.window = previousWindow;
  }
});
