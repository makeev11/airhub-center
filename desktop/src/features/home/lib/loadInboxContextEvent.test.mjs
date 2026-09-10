import assert from "node:assert/strict";
import test from "node:test";
import { loadInboxContextEvent } from "./loadInboxContextEvent.ts";

const event = { id: "root", tags: [["h", "channel"]], kind: 9 };
const unavailable = () => Promise.reject(new Error("HTTP unavailable"));
const options = {
  eventId: "root",
  channelId: "channel",
  getCachedEvents: () => [],
  fetchEvent: unavailable,
  fetchChannelEvents: async () => [],
};

test("already loaded ancestors do not need a network request", async () => {
  let calls = 0;
  const result = await loadInboxContextEvent({
    ...options,
    getCachedEvents: () => [event],
    fetchEvent: async () => {
      calls++;
      throw new Error("offline");
    },
  });
  assert.equal(result, event);
  assert.equal(calls, 0);
});

test("HTTP failures recover through the channel connection", async () => {
  const result = await loadInboxContextEvent({
    ...options,
    fetchChannelEvents: async (channelId, eventId) => {
      assert.equal(channelId, "channel");
      assert.equal(eventId, "root");
      return [event];
    },
  });
  assert.equal(result, event);
});

test("history arriving during a failed request recovers the ancestor", async () => {
  let cached = [];
  const result = await loadInboxContextEvent({
    ...options,
    getCachedEvents: () => cached,
    fetchEvent: async () => {
      cached = [event];
      throw new Error("timeout");
    },
  });
  assert.equal(result, event);
});

test("missing context remains an error rather than silently claiming completeness", async () => {
  await assert.rejects(loadInboxContextEvent(options), /HTTP unavailable/);
});

test("events from another channel are never used as context", async () => {
  const wrongChannel = { ...event, tags: [["h", "other"]] };
  await assert.rejects(
    loadInboxContextEvent({
      ...options,
      getCachedEvents: () => [wrongChannel],
      fetchEvent: async () => wrongChannel,
      fetchChannelEvents: async () => [wrongChannel],
    }),
    /does not match/,
  );
});
