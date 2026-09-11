import assert from "node:assert/strict";
import test from "node:test";
import { ClientInboxService } from "./clientInboxService.ts";

const id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
test("client mutations retry the exact signed command, not a new mutation", async () => {
  const signed = [],
    requests = [];
  const service = new ClientInboxService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (event) => {
      signed.push(event);
      return {
        ...event,
        id: "ab".repeat(32),
        pubkey: "cd".repeat(32),
        sig: "ef".repeat(64),
      };
    },
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (requests.length === 1) throw new TypeError("connection lost");
      return new Response(JSON.stringify({ accepted: true, message: "{}" }));
    },
  });
  await service.command(
    id,
    { id, version: 7 },
    { type: "assign_branch", branchId: id },
    id,
  );
  assert.equal(signed.filter((event) => event.kind === 9051).length, 1);
  assert.equal(requests[0].options.body, requests[1].options.body);
  assert.equal(requests[0].options.cache, "no-store");
  assert.equal(requests[0].options.redirect, "error");
  const command = JSON.parse(JSON.parse(requests[0].options.body).content);
  assert.equal(command.expectedVersion, 7);
  assert.equal(command.idempotencyKey, id);
  for (const request of requests) {
    const auth = JSON.parse(
      atob(request.options.headers.Authorization.slice(6)),
    );
    assert.ok(
      auth.tags.some((tag) => tag[0] === "u" && tag[1] === request.url),
    );
    assert.ok(
      auth.tags.some((tag) => tag[0] === "payload" && tag[1].length === 64),
    );
  }
});
test("a conflict is surfaced without retrying a stale client action", async () => {
  let requests = 0;
  const service = new ClientInboxService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (event) => event,
    fetch: async () => {
      requests++;
      return new Response(JSON.stringify({ error: "conflict: refresh" }), {
        status: 400,
      });
    },
  });
  await assert.rejects(
    service.command(
      id,
      { id, version: 2 },
      { type: "set_status", status: "resolved" },
    ),
    /conflict/,
  );
  assert.equal(requests, 1);
});

test("routing configuration read does not request conversation rows", async () => {
  let requestedUrl = "";
  const service = new ClientInboxService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (event) => event,
    fetch: async (url) => {
      requestedUrl = String(url);
      return new Response(
        JSON.stringify({
          communityId: id,
          viewerPubkey: "ab".repeat(32),
          canManageRouting: true,
          connections: [],
          items: [],
          nextCursor: null,
          branches: [],
          staff: [],
        }),
      );
    },
  });

  await service.loadRoutingConfiguration();
  assert.equal(
    requestedUrl,
    "https://center.example/api/airhop/staff/v1/client-conversations?configurationOnly=true",
  );
});
