import assert from "node:assert/strict";
import test from "node:test";
import { airhopUpdaterConfig } from "./airhop-updater-config.mjs";

const endpoint =
  "https://github.com/makeev11/airhub-center/releases/download/airhop-center-latest/latest.json";
test("ordinary builds do not enable an unconfigured updater", () => {
  assert.equal(airhopUpdaterConfig({}), null);
});
test("configured updates use the Center channel and public key", () => {
  assert.deepEqual(
    airhopUpdaterConfig({
      AIRHOP_UPDATER_PUBLIC_KEY: " public-key ",
      AIRHOP_UPDATER_ENDPOINT: endpoint,
    }),
    { pubkey: "public-key", endpoints: [endpoint] },
  );
});
test("partial, insecure or credential-bearing settings fail closed", () => {
  for (const env of [
    { AIRHOP_UPDATER_PUBLIC_KEY: "public-key" },
    { AIRHOP_UPDATER_ENDPOINT: endpoint },
    ...[
      "http://example.com/latest.json",
      "https://secret@example.com/latest.json",
      "https://example.com/latest.json#fragment",
    ].map((url) => ({
      AIRHOP_UPDATER_PUBLIC_KEY: "public-key",
      AIRHOP_UPDATER_ENDPOINT: url,
    })),
  ])
    assert.throws(() => airhopUpdaterConfig(env));
});
