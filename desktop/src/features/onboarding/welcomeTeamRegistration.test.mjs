import assert from "node:assert/strict";
import test from "node:test";

import { createWelcomeTeamRegistrar } from "./welcomeTeamRegistration.ts";

test("registration sends the exact role manifest with NIP-98 auth", async () => {
  const requests = [];
  const signed = [];
  const register = createWelcomeTeamRegistrar({
    relayHttpUrl: async () => "http://relay.test",
    nonceFactory: () => "nonce-1",
    signEvent: async (input) => {
      signed.push(input);
      return {
        id: "1".repeat(64),
        pubkey: "2".repeat(64),
        created_at: 1,
        kind: 27235,
        tags: input.tags,
        content: "",
        sig: "3".repeat(128),
      };
    },
    fetch: async (url, init) => {
      requests.push({ url, init });
      return new Response(
        JSON.stringify({
          organizationId: "org-1",
          channelId: "welcome-1",
          locale: "ru-RU",
          members: {
            fizz: "a".repeat(64),
            administrator: "b".repeat(64),
            analyst: "c".repeat(64),
            content_marketer: "d".repeat(64),
          },
          version: 1,
          updatedAt: "2026-08-18T00:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    },
  });

  const result = await register({
    organizationId: "org-1",
    channelId: "welcome-1",
    locale: "ru-RU",
    members: {
      fizz: "a".repeat(64),
      administrator: "b".repeat(64),
      analyst: "c".repeat(64),
      content_marketer: "d".repeat(64),
    },
  });

  assert.deepEqual(result.members, {
    fizz: "a".repeat(64),
    administrator: "b".repeat(64),
    analyst: "c".repeat(64),
    content_marketer: "d".repeat(64),
  });
  assert.equal(result.channelId, "welcome-1");
  assert.equal(result.locale, "ru-RU");
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].url,
    "http://relay.test/api/airhop/agents/v1/welcome-team",
  );
  assert.equal(requests[0].init.method, "PUT");
  assert.match(requests[0].init.headers.Authorization, /^Nostr /);
  assert.deepEqual(JSON.parse(requests[0].init.body).members, result.members);
  assert.ok(signed[0].tags.some((tag) => tag[0] === "payload"));
});

test("registration rejects malformed server role maps", async () => {
  const register = createWelcomeTeamRegistrar({
    relayHttpUrl: async () => "http://relay.test",
    nonceFactory: () => "nonce-1",
    signEvent: async (input) => ({
      id: "1".repeat(64),
      pubkey: "2".repeat(64),
      created_at: 1,
      kind: 27235,
      tags: input.tags,
      content: "",
      sig: "3".repeat(128),
    }),
    fetch: async () =>
      new Response(
        JSON.stringify({
          organizationId: "org-1",
          channelId: "welcome-1",
          locale: "ru-RU",
          members: { fizz: "a".repeat(64) },
          version: 1,
          updatedAt: "2026-08-18T00:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
  });

  await assert.rejects(
    () =>
      register({
        organizationId: "org-1",
        channelId: "welcome-1",
        locale: "ru-RU",
        members: {
          fizz: "a".repeat(64),
          administrator: "b".repeat(64),
          analyst: "c".repeat(64),
          content_marketer: "d".repeat(64),
        },
      }),
    /invalid Welcome team response/i,
  );
});
