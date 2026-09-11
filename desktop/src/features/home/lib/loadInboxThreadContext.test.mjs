import assert from "node:assert/strict";
import test from "node:test";
import { loadInboxThreadContext } from "./loadInboxThreadContext.ts";

const root = { id: "root", tags: [["h", "channel"]], kind: 9 };
const reply = {
  ...root,
  id: "reply",
  tags: [
    ["h", "channel"],
    ["e", "root", "", "root"],
    ["e", "root", "", "reply"],
  ],
};
const options = {
  selectedEvent: reply,
  loadEvent: async () => null,
  loadDescendants: async () => [],
};

test("stale Inbox copy and absent root produce unavailable, not a network error", async () => {
  const result = await loadInboxThreadContext(options);
  assert.deepEqual(result, {
    events: [],
    hasLoadError: false,
    unavailable: "thread",
  });
});

test("valid anchor and root are fetched once even when root equals parent", async () => {
  const calls = [];
  const result = await loadInboxThreadContext({
    ...options,
    loadEvent: async (id) => {
      calls.push(id);
      return id === "root" ? root : reply;
    },
  });
  assert.deepEqual(calls.sort(), ["reply", "root"]);
  assert.equal(result.unavailable, null);
  assert.equal(result.hasLoadError, false);
  assert.equal(result.events.length, 2);
});

test("an unavailable parent does not discard surviving replies", async () => {
  const result = await loadInboxThreadContext({
    ...options,
    loadEvent: async (id) => (id === "reply" ? reply : null),
    loadDescendants: async () => [reply],
  });
  assert.equal(result.unavailable, "partial");
  assert.deepEqual(result.events, [reply]);
  assert.equal(result.hasLoadError, false);
});

test("an absent selected message is distinguished from an absent whole discussion", async () => {
  const result = await loadInboxThreadContext({
    ...options,
    loadEvent: async (id) => (id === "root" ? root : null),
  });
  assert.equal(result.unavailable, "message");
  assert.deepEqual(result.events, [root]);
});

test("offline lookups remain retryable and never mark saved messages missing", async () => {
  const fail = async () => {
    throw new Error("offline");
  };
  const result = await loadInboxThreadContext({
    ...options,
    loadEvent: fail,
    loadDescendants: fail,
  });
  assert.equal(result.hasLoadError, true);
  assert.equal(result.unavailable, null);
});

test("failed descendant lookup cannot declare the entire discussion absent", async () => {
  const result = await loadInboxThreadContext({
    ...options,
    loadDescendants: async () => {
      throw new Error("timeout");
    },
  });
  assert.equal(result.hasLoadError, true);
  assert.equal(result.unavailable, "message");
});

test("successful descendant lookup recovers an anchor that arrived after not-found", async () => {
  const result = await loadInboxThreadContext({
    ...options,
    loadDescendants: async () => [root, reply],
  });
  assert.equal(result.unavailable, null);
  assert.equal(result.hasLoadError, false);
  assert.equal(result.events.length, 2);
});

test("top-level notification is also validated and deduplicated", async () => {
  let calls = 0;
  const result = await loadInboxThreadContext({
    ...options,
    selectedEvent: root,
    loadEvent: async () => {
      calls++;
      return null;
    },
  });
  assert.equal(result.unavailable, "thread");
  assert.equal(calls, 1);
});

test("cyclic ancestor tags terminate without repeated network calls", async () => {
  const parent = {
    ...reply,
    id: "parent",
    tags: [["e", "parent", "", "reply"]],
  };
  const result = await loadInboxThreadContext({
    ...options,
    selectedEvent: {
      ...reply,
      tags: [
        ["e", "root", "", "root"],
        ["e", "parent", "", "reply"],
      ],
    },
    loadEvent: async (id) =>
      id === "parent" ? parent : id === "root" ? root : reply,
  });
  assert.equal(result.hasLoadError, false);
  assert.equal(result.events.length, 3);
});
