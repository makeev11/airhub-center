import test from "node:test";
import assert from "node:assert/strict";
import { getPublicKey } from "nostr-tools/pure";
import { sign } from "./identity.ts";
import { ChatRelay } from "./relay.ts";

const secret = new Uint8Array(32);
secret[31] = 12;
const identity = {
  secret,
  pubkey: getPublicKey(secret),
  origin: "https://center.example",
};
const tick = () => new Promise((resolve) => setImmediate(resolve));
class FakeSocket {
  static OPEN = 1;
  static instances = [];
  readyState = 1;
  frames = [];
  constructor() {
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      this.onopen?.();
      this.receive(["AUTH", "challenge"]);
    });
  }
  send(data) {
    const frame = JSON.parse(data);
    this.frames.push(frame);
    if (frame[0] === "AUTH")
      queueMicrotask(() => this.receive(["OK", frame[1].id, true, ""]));
  }
  receive(frame) {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
  close() {
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.());
  }
}

test("NIP-42 auth precedes queries; signed filters, EOSE and server ACK are enforced", async (t) => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  t.after(() => {
    globalThis.WebSocket = original;
  });
  const relay = new ChatRelay("wss://center.example", identity);
  t.after(() => relay.close());
  await relay.connect();
  const socket = FakeSocket.instances.at(-1);
  const auth = socket.frames.find((frame) => frame[0] === "AUTH")[1];
  assert.equal(auth.kind, 22242);
  assert.deepEqual(auth.tags, [
    ["relay", "wss://center.example"],
    ["challenge", "challenge"],
  ]);
  const query = relay.query([{ kinds: [9], "#h": ["team"] }]);
  const req = socket.frames.at(-1);
  const good = sign(identity, {
    kind: 9,
    content: "hello",
    tags: [["h", "team"]],
  });
  socket.receive(["EVENT", req[1], { ...good, content: "tampered" }]);
  socket.receive([
    "EVENT",
    req[1],
    sign(identity, {
      kind: 9,
      content: "wrong channel",
      tags: [["h", "private"]],
    }),
  ]);
  socket.receive(["EVENT", req[1], good]);
  socket.receive(["EOSE", req[1]]);
  assert.deepEqual(JSON.parse(JSON.stringify(await query)), [
    JSON.parse(JSON.stringify(good)),
  ]);
  let sent = false;
  const send = relay.publish(good).then(() => {
    sent = true;
  });
  await tick();
  assert.equal(sent, false);
  socket.receive(["OK", good.id, true, ""]);
  await send;
  assert.equal(sent, true);
  const reject = relay.publish(good);
  await tick();
  socket.receive(["OK", good.id, false, "denied"]);
  await assert.rejects(reject, /отклонил/);
  assert.throws(
    () =>
      relay.subscribe(
        [{}],
        () => {},
        () => {},
      ),
    /тип/,
  );
});

test("loss rejects ambiguous send, then retry keeps exactly the same signed ID", async (t) => {
  const original = globalThis.WebSocket;
  globalThis.WebSocket = FakeSocket;
  t.after(() => {
    globalThis.WebSocket = original;
  });
  const relay = new ChatRelay("wss://center.example", identity);
  t.after(() => relay.close());
  await relay.connect();
  const socket = FakeSocket.instances.at(-1);
  const event = sign(identity, {
    kind: 9,
    content: "retry",
    tags: [["h", "team"]],
  });
  const send = relay.publish(event);
  const rejected = assert.rejects(send, /подтверждения/);
  await tick();
  socket.close();
  await rejected;
  const retry = relay.publish(event);
  await tick();
  const next = FakeSocket.instances.at(-1);
  assert.notEqual(next, socket);
  assert.equal(
    next.frames.find((frame) => frame[0] === "EVENT")[1].id,
    event.id,
  );
  next.receive(["OK", event.id, true, "duplicate"]);
  await retry;
});

test("denied authentication never subscribes or publishes", async (t) => {
  class DeniedSocket extends FakeSocket {
    send(data) {
      const frame = JSON.parse(data);
      this.frames.push(frame);
      if (frame[0] === "AUTH")
        queueMicrotask(() =>
          this.receive(["OK", frame[1].id, false, "denied"]),
        );
    }
  }
  const original = globalThis.WebSocket;
  globalThis.WebSocket = DeniedSocket;
  t.after(() => {
    globalThis.WebSocket = original;
  });
  const relay = new ChatRelay("wss://center.example", identity);
  t.after(() => relay.close());
  await assert.rejects(relay.connect(), /отклонил/);
  assert.equal(relay.state, "denied");
  assert.equal(
    FakeSocket.instances
      .at(-1)
      .frames.some((frame) => ["EVENT", "REQ"].includes(frame[0])),
    false,
  );
  await assert.rejects(relay.query([{ kinds: [9] }]), /закрыто/);
});
