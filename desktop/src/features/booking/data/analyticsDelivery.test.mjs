import assert from "node:assert/strict";
import test from "node:test";
import { createAnalyticsDelivery } from "./analyticsDelivery.mjs";

function harness(saved = new Map()) {
  let clock = Date.now();
  let sequence = 0;
  const timers = new Map();
  const listeners = new Map();
  const requests = [];
  const beacons = [];
  const replies = [];
  const env = {
    Date: { now: () => clock },
    AbortController,
    Blob,
    sessionStorage: {
      getItem: (key) => saved.get(key) ?? null,
      setItem: (key, value) => saved.set(key, value),
    },
    navigator: {
      onLine: true,
      sendBeacon: (...args) => {
        beacons.push(args);
        return true;
      },
    },
    document: { addEventListener() {}, removeEventListener() {} },
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    setTimeout: (fn, delay) => {
      const id = ++sequence;
      timers.set(id, { fn, at: clock + delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: async (url, init) => {
      requests.push({ url, init });
      const reply = replies.shift();
      if (reply instanceof Error) throw reply;
      return (
        reply ??
        Response.json(
          { accepted: JSON.parse(init.body).events.length, recorded: 1 },
          { status: 202 },
        )
      );
    },
  };
  const event = (id = "event-1") => ({
    eventId: id,
    occurredAt: new Date(clock).toISOString(),
    eventType: "site_page_view",
  });
  async function advance(ms) {
    clock += ms;
    for (const [id, task] of [...timers]) {
      if (task.at <= clock) {
        timers.delete(id);
        task.fn();
      }
    }
    await new Promise((resolve) => setImmediate(resolve));
  }
  return { env, requests, replies, saved, listeners, beacons, advance, event };
}

test("batches events and retries the same identities after a transient failure", async () => {
  const h = harness();
  h.replies.push(new Error("offline"));
  const client = createAnalyticsDelivery(h.env);
  client.capture([h.event("a"), h.event("b")]);
  assert.equal(h.requests.length, 0);
  await h.advance(250);
  const original = h.requests[0].init.body;
  await h.advance(999);
  assert.equal(h.requests.length, 1);
  await h.advance(1);
  assert.equal(h.requests.length, 2);
  assert.equal(h.requests[1].init.body, original);
  assert.deepEqual(
    JSON.parse(h.saved.get("airhop.analytics.outbox.v1")).queue,
    [],
  );
  client.dispose();
});

test("a static HTML fallback is never treated as a collector acknowledgement", async () => {
  const h = harness();
  h.replies.push(new Response("<html>Site</html>", { status: 200 }));
  const client = createAnalyticsDelivery(h.env);
  client.capture([h.event()]);
  await h.advance(250);
  assert.equal(
    JSON.parse(h.saved.get("airhop.analytics.outbox.v1")).queue.length,
    1,
  );
  await h.advance(1000);
  assert.equal(h.requests.length, 2);
  client.dispose();
});

test("outbox survives navigation and beacon sends do not erase unacknowledged events", async () => {
  const h = harness();
  const client = createAnalyticsDelivery(h.env);
  client.capture([h.event()]);
  h.listeners.get("pagehide")();
  assert.equal(h.beacons.length, 1);
  client.dispose();
  const next = harness(h.saved);
  const replay = createAnalyticsDelivery(next.env);
  await next.advance(250);
  assert.equal(
    JSON.parse(next.requests[0].init.body).events[0].eventId,
    "event-1",
  );
  replay.dispose();
});

test("caps bytes, batch size and memory and expires events before the server age limit", async () => {
  const h = harness();
  const client = createAnalyticsDelivery(h.env);
  client.capture([
    h.event("expired"),
    ...Array.from({ length: 80 }, (_, i) => h.event(String(i))),
    { ...h.event("too-large"), campaign: "я".repeat(2000) },
  ]);
  const saved = JSON.parse(h.saved.get("airhop.analytics.outbox.v1")).queue;
  assert.equal(saved.length, 40);
  assert.equal(saved[0].eventId, "40");
  await h.advance(250);
  assert.ok(Buffer.byteLength(h.requests[0].init.body) < 16 * 1024);
  assert.equal(JSON.parse(h.requests[0].init.body).events.length, 6);
  await h.advance(24 * 60 * 60 * 1000);
  assert.equal(h.requests.length, 1);
  client.dispose();
});

test("honours Retry-After and stops retrying absent collectors", async () => {
  const h = harness();
  h.replies.push(
    new Response(null, { status: 429, headers: { "retry-after": "30" } }),
    new Response(null, { status: 404 }),
  );
  const client = createAnalyticsDelivery(h.env);
  client.capture([h.event()]);
  await h.advance(250);
  await h.advance(29999);
  assert.equal(h.requests.length, 1);
  await h.advance(1);
  assert.equal(h.requests.length, 2);
  client.capture([h.event("later")]);
  await h.advance(60000);
  assert.equal(h.requests.length, 2);
  client.dispose();
});

test("storage getter failures keep capture and successful delivery functional", async () => {
  const h = harness();
  Object.defineProperty(h.env, "sessionStorage", {
    get() {
      throw new Error("denied");
    },
  });
  const client = createAnalyticsDelivery(h.env);
  client.capture([h.event()]);
  await h.advance(250);
  assert.equal(h.requests.length, 1);
  client.dispose();
});

test("one rejected event cannot discard the rest of a batch", async () => {
  const h = harness();
  h.replies.push(
    new Response(null, { status: 422 }),
    new Response(null, { status: 422 }),
  );
  const client = createAnalyticsDelivery(h.env);
  client.capture([h.event("bad"), h.event("good")]);
  await h.advance(250);
  await h.advance(250);
  await h.advance(250);
  assert.equal(JSON.parse(h.requests[2].init.body).events[0].eventId, "good");
  client.dispose();
});

test("a disposed request cannot restore the outbox after a tenant switch", async () => {
  const h = harness();
  let rejectRequest;
  let signal;
  h.env.fetch = (_url, init) => {
    signal = init.signal;
    return new Promise((_resolve, reject) => {
      rejectRequest = reject;
    });
  };
  const client = createAnalyticsDelivery(h.env);
  client.capture([h.event("old-tenant")]);
  const pending = client.flush();
  client.dispose();
  assert.equal(signal.aborted, true);
  h.saved.delete("airhop.analytics.outbox.v1");
  rejectRequest(new Error("old request failed after switch"));
  await pending;
  assert.equal(h.saved.has("airhop.analytics.outbox.v1"), false);
  await h.advance(60000);
  assert.equal(h.saved.has("airhop.analytics.outbox.v1"), false);
});
