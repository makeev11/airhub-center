import assert from "node:assert/strict";
import test from "node:test";

import {
  activationCodeFingerprint,
  resolveAirHopActivationRelay,
} from "./airhopActivationDiscovery.ts";

test("activation discovery sends only a stable fingerprint to HQ", async () => {
  const code = "ahc_1_secret-owner-code";
  const fingerprint = await activationCodeFingerprint(code);
  const requests = [];
  const relayUrl = await resolveAirHopActivationRelay(code, {
    apiUrl: "https://hq.airhop.ru",
    fetchImpl: async (input, init) => {
      requests.push({ input: String(input), init });
      return Response.json({ relayUrl: "wss://center.ritm.example" });
    },
  });

  assert.equal(relayUrl, "wss://center.ritm.example");
  assert.match(fingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(requests.length, 1);
  assert.equal(
    requests[0].input,
    "https://hq.airhop.ru/api/hq/v1/activation/resolve",
  );
  assert.deepEqual(JSON.parse(requests[0].init.body), { fingerprint });
  assert.doesNotMatch(requests[0].init.body, new RegExp(code, "u"));
  assert.equal(requests[0].init.redirect, "error");
  assert.equal(requests[0].init.credentials, "omit");
});

test("activation discovery rejects unsafe or malformed Center addresses", async () => {
  for (const relayUrl of [
    "http://center.example",
    "ws://center.example",
    "wss://",
  ]) {
    await assert.rejects(
      resolveAirHopActivationRelay("code", {
        apiUrl: "https://hq.airhop.ru",
        fetchImpl: async () => Response.json({ relayUrl }),
      }),
      /invalid|insecure/u,
    );
  }
});
