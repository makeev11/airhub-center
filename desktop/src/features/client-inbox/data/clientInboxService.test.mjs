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

function routingConfiguration() {
  return {
    communityId: id,
    viewerPubkey: "ab".repeat(32),
    canManageRouting: true,
    branches: [
      {
        id,
        name: "Курская",
        channelId: id,
        version: 7,
        responsiblePubkeys: ["cd".repeat(32)],
      },
    ],
    staff: [{ pubkey: "cd".repeat(32), name: "Анна", channelId: id }],
  };
}

test("legacy routing read uses a signed empty-history filter and preserves branch versions for saving", async () => {
  const requests = [];
  const config = routingConfiguration();
  const service = new ClientInboxService({
    relayHttpUrl: async () => "https://center.example/",
    signEvent: async (event) => event,
    fetch: async (url, options) => {
      requests.push({ url, options });
      if (url.endsWith("/events"))
        return Response.json({ accepted: true, message: "{}" });
      if (new URL(url).searchParams.has("configurationOnly"))
        return Response.json(
          { error: "Invalid Inbox filters" },
          { status: 400 },
        );
      return Response.json({
        ...config,
        items: [],
        connections: [],
        nextCursor: null,
      });
    },
  });

  const routing = await service.loadRoutingConfiguration();
  assert.deepEqual(routing, config);
  assert.equal(requests.length, 2);
  assert.equal(
    requests[1].url,
    "https://center.example/api/airhop/staff/v1/client-conversations?conversationId=00000000-0000-0000-0000-000000000000",
  );
  for (const { url, options } of requests) {
    assert.equal(options.method, "GET");
    const auth = JSON.parse(atob(options.headers.Authorization.slice(6)));
    assert.ok(auth.tags.some((tag) => tag[0] === "u" && tag[1] === url));
    assert.ok(auth.tags.some((tag) => tag[0] === "method" && tag[1] === "GET"));
  }

  await service.setResponsibles(routing.communityId, routing.branches[0], []);
  const event = JSON.parse(requests[2].options.body);
  assert.equal(event.kind, 9051);
  assert.ok(
    event.tags.some((tag) => tag[0] === "airhop-community" && tag[1] === id),
  );
  const command = JSON.parse(event.content);
  assert.equal(command.branchId, id);
  assert.equal(command.expectedVersion, 7);
  assert.deepEqual(command.responsiblePubkeys, []);
});

test("routing configuration does not depend on conversation schemas", async () => {
  const config = routingConfiguration();
  const service = new ClientInboxService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (event) => event,
    fetch: async () => Response.json({ ...config, items: [{ old: "schema" }] }),
  });
  assert.deepEqual(await service.loadRoutingConfiguration(), config);
  await assert.rejects(service.load());
});

for (const [status, error] of [
  [403, "Invalid Inbox filters"],
  [500, "Invalid Inbox filters"],
  [400, "Invalid authentication"],
]) {
  test(`routing does not hide HTTP ${status}: ${error}`, async () => {
    let requests = 0;
    const service = new ClientInboxService({
      relayHttpUrl: async () => "https://center.example",
      signEvent: async (event) => event,
      fetch: async () => {
        requests++;
        return Response.json({ error }, { status });
      },
    });
    await assert.rejects(service.loadRoutingConfiguration(), {
      message: error,
    });
    assert.equal(requests, 1);
  });
}

test("routing does not retry a network failure or invalid configuration", async () => {
  for (const response of [new TypeError("network lost"), { staff: [] }]) {
    let requests = 0;
    const service = new ClientInboxService({
      relayHttpUrl: async () => "https://center.example",
      signEvent: async (event) => event,
      fetch: async () => {
        requests++;
        if (response instanceof Error) throw response;
        return Response.json(response);
      },
    });
    await assert.rejects(service.loadRoutingConfiguration());
    assert.equal(requests, 1);
  }
});

test("legacy fallback failure is surfaced once and the next load probes modern support again", async () => {
  const urls = [];
  const service = new ClientInboxService({
    relayHttpUrl: async () => "https://center.example",
    signEvent: async (event) => event,
    fetch: async (url) => {
      urls.push(url);
      if (urls.length === 1)
        return Response.json(
          { error: "Invalid Inbox filters" },
          { status: 400 },
        );
      if (urls.length === 2)
        return Response.json({ error: "Unavailable" }, { status: 503 });
      return Response.json(routingConfiguration());
    },
  });
  await assert.rejects(service.loadRoutingConfiguration(), /Unavailable/);
  assert.equal(urls.length, 2);
  assert.deepEqual(
    await service.loadRoutingConfiguration(),
    routingConfiguration(),
  );
  assert.equal(urls[2], urls[0]);
});
