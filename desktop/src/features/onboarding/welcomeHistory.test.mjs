import assert from "node:assert/strict";
import test from "node:test";
import { loadWelcomeHistory } from "./welcomeHistory.ts";

test("Welcome reads older receipts across equal timestamps and deduplicates replay", async () => {
  const cursor = { createdAt: 10, eventId: "a".repeat(64) };
  let calls = 0;
  const result = await loadWelcomeHistory(
    "welcome",
    async (channel, before) => {
      assert.equal(channel, "welcome");
      calls += 1;
      if (calls === 1) return { events: [{ id: "new" }], nextCursor: cursor };
      assert.deepEqual(before, cursor);
      return { events: [{ id: "new" }, { id: "old-intro" }], nextCursor: null };
    },
  );
  assert.deepEqual(
    result.map((event) => event.id),
    ["new", "old-intro"],
  );
});

test("history failure and nonadvancing cursor do not return an empty Welcome", async () => {
  await assert.rejects(
    loadWelcomeHistory("welcome", async () => {
      throw new Error("offline");
    }),
    /offline/,
  );
  const cursor = { createdAt: 10, eventId: "a".repeat(64) };
  await assert.rejects(
    loadWelcomeHistory("welcome", async () => ({
      events: [],
      nextCursor: cursor,
    })),
    /did not advance/,
  );
});

test("switching away aborts history before another page can be read", async () => {
  const controller = new AbortController();
  let calls = 0;
  await assert.rejects(
    loadWelcomeHistory(
      "welcome",
      async () => {
        calls += 1;
        controller.abort();
        return {
          events: [],
          nextCursor: { createdAt: 10, eventId: "a".repeat(64) },
        };
      },
      controller.signal,
    ),
    { name: "AbortError" },
  );
  assert.equal(calls, 1);
});
