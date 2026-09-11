import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { KnowledgeService } from "./knowledgeService.ts";
const id = "11111111-1111-4111-8111-111111111111";
function signed(input) {
  return { ...input, id: "test", pubkey: "test", created_at: 1, sig: "test" };
}
test("Nostr command binds tenant, payload and retry identity without a new edit API", async () => {
  const bodies = [],
    signatures = [];
  let attempts = 0;
  const service = new KnowledgeService({
    relayHttpUrl: async () => "https://center.test",
    signEvent: async (input) => {
      signatures.push(input);
      return signed(input);
    },
    fetch: async (url, init) => {
      assert.equal(url, "https://center.test/events");
      bodies.push(init.body);
      attempts++;
      if (attempts === 1) throw new TypeError("lost acknowledgement");
      return Response.json({ accepted: true, message: '{"version":2}' });
    },
  });
  await service.command(id, { operation: "publish", id, expectedVersion: 1 });
  assert.equal(bodies[0], bodies[1]);
  assert.equal(signatures[0].kind, 9050);
  assert.deepEqual(signatures[0].tags[0], ["airhop-community", id]);
  for (const auth of signatures.slice(1)) {
    assert.equal(auth.kind, 27235);
    assert.ok(
      auth.tags.some(
        (t) =>
          t[0] === "payload" &&
          t[1] === createHash("sha256").update(bodies[0]).digest("hex"),
      ),
    );
  }
});
test("unavailable or malformed artifacts never become an empty successful workspace", async () => {
  const options = {
    relayHttpUrl: async () => "https://center.test",
    signEvent: async (input) => signed(input),
  };
  await assert.rejects(
    new KnowledgeService({
      ...options,
      fetch: async () => Response.json({ error: "offline" }, { status: 503 }),
    }).manifest(),
    /offline/,
  );
  await assert.rejects(
    new KnowledgeService({
      ...options,
      fetch: async () => Response.json({}),
    }).manifest(),
  );
});
test("parent preview signs the exact encoded search and scope", async () => {
  let auth;
  const service = new KnowledgeService({
    relayHttpUrl: async () => "https://center.test",
    signEvent: async (input) => {
      auth = input;
      return signed(input);
    },
    fetch: async (url) => {
      assert.equal(new URL(url).searchParams.get("query"), "сменная обувь");
      assert.ok(auth.tags.some((t) => t[0] === "u" && t[1] === url));
      return Response.json({ documents: [], isModelAnswer: false });
    },
  });
  const result = await service.parentPreview("сменная обувь", id);
  assert.equal(result.isModelAnswer, false);
});
