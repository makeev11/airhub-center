import assert from "node:assert/strict";
import test from "node:test";

import { createAirhopControlPlaneClient } from "./airhopControlPlane.ts";

const CONNECTION_ID = "11111111-1111-4111-8111-111111111111";
const ORGANIZATION_ID = "22222222-2222-4222-8222-222222222222";
const DEPLOYMENT_ID = "33333333-3333-4333-8333-333333333333";
const PUBKEY = "11".repeat(32);

function connection(overrides = {}) {
  return {
    id: CONNECTION_ID,
    organizationId: ORGANIZATION_ID,
    provider: "telegram",
    displayName: "Основной Telegram",
    connectorPubkey: PUBKEY,
    status: "active",
    hermesEnabled: true,
    capabilities: { text: true },
    observedStatus: "ready",
    observedCapabilities: { text: true },
    lastHeartbeatAt: "2026-08-21T12:00:00Z",
    lastErrorCode: null,
    version: 1,
    ...overrides,
  };
}

function deployment(overrides = {}) {
  return {
    schemaVersion: "airhop.agent.deployment.v1",
    id: DEPLOYMENT_ID,
    organizationId: ORGANIZATION_ID,
    blueprintKey: "airhop.hermes.parent_administrator",
    blueprintVersion: 1,
    role: "parent_administrator",
    agentPubkey: PUBKEY,
    profileRef: "organizations/example/hermes",
    runtimeRevision: "e624e9f",
    personaRevision: "hermes-parent-v1",
    skillsRevision: "airhop-parent-v1",
    modelRevision: "deepseek-flash",
    enabled: true,
    paused: false,
    manageBookings: true,
    version: 3,
    createdAt: "2026-08-21T10:00:00Z",
    updatedAt: "2026-08-21T12:00:00Z",
    ...overrides,
  };
}

test("control plane signs exact URL and payload without provider secrets", async () => {
  const calls = [];
  const signed = [];
  const responses = [
    {
      schemaVersion: "airhop.channel-connections.v1",
      connections: [connection()],
    },
    {
      schemaVersion: "airhop.channel-connection.v1",
      connection: connection({ hermesEnabled: false, version: 2 }),
    },
  ];
  const client = createAirhopControlPlaneClient({
    relayHttpUrl: async () => "https://center.example/",
    nonceFactory: () => "nonce-1",
    signEvent: async (input) => {
      signed.push(input);
      return { id: "event", kind: input.kind };
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(responses.shift()), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    },
  });

  const listed = await client.listConnections();
  assert.equal(listed[0].observedStatus, "ready");
  await client.putConnection({
    id: CONNECTION_ID,
    provider: "telegram",
    displayName: "Основной Telegram",
    connectorPubkey: PUBKEY,
    status: "active",
    hermesEnabled: false,
    capabilities: { text: true },
    expectedVersion: 1,
  });

  assert.equal(
    calls[0].url,
    "https://center.example/api/airhop/integrations/v1/channel-connections",
  );
  assert.equal(calls[0].init.credentials, "omit");
  assert.match(calls[0].init.headers.Authorization, /^Nostr /);
  assert.equal(signed[0].kind, 27235);
  assert.deepEqual(signed[0].tags.slice(0, 3), [
    [
      "u",
      "https://center.example/api/airhop/integrations/v1/channel-connections",
    ],
    ["method", "GET"],
    ["nonce", "nonce-1"],
  ]);
  assert.equal(signed[1].tags.at(-1)[0], "payload");
  assert.doesNotMatch(calls[1].init.body, /botToken|telegram-secret/i);
});

test("Telegram token uses only the write-only provisioning request", async () => {
  const token = "123456789:abcdefghijklmnopqrstuvwxyz_ABCD";
  const calls = [];
  const signed = [];
  const client = createAirhopControlPlaneClient({
    relayHttpUrl: async () => "https://center.example",
    nonceFactory: () => "nonce-telegram",
    signEvent: async (input) => {
      signed.push(input);
      return { id: "event", kind: input.kind };
    },
    fetch: async (url, init) => {
      calls.push({ url, init });
      return new Response(
        JSON.stringify({
          schemaVersion: "airhop.telegram-connection.v1",
          connection: connection({ displayName: "@airhop_demo_bot" }),
          bot: {
            id: "123456789",
            firstName: "Airhop Demo",
            username: "airhop_demo_bot",
          },
        }),
        { status: 200 },
      );
    },
  });

  const result = await client.connectTelegram(token);
  assert.equal(result.connection.displayName, "@airhop_demo_bot");
  assert.equal(
    calls[0].url,
    "https://center.example/api/airhop/integrations/v1/channel-connections/telegram",
  );
  assert.equal(calls[0].init.method, "POST");
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    token,
    hermesEnabled: true,
  });
  assert.doesNotMatch(JSON.stringify(signed[0]), new RegExp(token));
  assert.doesNotMatch(JSON.stringify(result), new RegExp(token));
});

test("Hermes toggle preserves pinned deployment identity and revisions", async () => {
  const current = deployment();
  const bodies = [];
  const responses = [
    {
      schemaVersion: "airhop.agent.deployments.v1",
      deployment: current,
    },
    deployment({ enabled: false, version: 4 }),
  ];
  const client = createAirhopControlPlaneClient({
    relayHttpUrl: async () => "https://center.example",
    nonceFactory: () => "nonce-2",
    signEvent: async (input) => ({ id: "event", kind: input.kind }),
    fetch: async (_url, init) => {
      if (init.body) bodies.push(JSON.parse(init.body));
      return new Response(JSON.stringify(responses.shift()), { status: 200 });
    },
  });

  const loaded = await client.getCurrentHermesDeployment();
  assert.equal(loaded.id, DEPLOYMENT_ID);
  const updated = await client.putHermesDeployment(loaded, { enabled: false });
  assert.equal(updated.enabled, false);
  assert.deepEqual(bodies[0], {
    agentPubkey: PUBKEY,
    blueprintVersion: 1,
    profileRef: "organizations/example/hermes",
    runtimeRevision: "e624e9f",
    personaRevision: "hermes-parent-v1",
    skillsRevision: "airhop-parent-v1",
    modelRevision: "deepseek-flash",
    enabled: false,
    paused: false,
    manageBookings: true,
    expectedVersion: 3,
  });
});
