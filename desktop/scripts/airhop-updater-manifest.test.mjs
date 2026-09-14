import assert from "node:assert/strict";
import test from "node:test";
import { makeAirhopUpdaterManifest } from "./airhop-updater-manifest.mjs";

// Structural fixture only. Cryptographic verification is performed by Tauri.
const signature = Buffer.from(
  `untrusted comment: fixture\n${Buffer.alloc(74).toString("base64")}\ntrusted comment: fixture\n${Buffer.alloc(64).toString("base64")}\n`,
).toString("base64");
const input = {
  version: "0.5.13",
  previousVersion: "0.5.12",
  signature,
  url: "https://github.com/makeev11/airhub-center/releases/download/airhop-desktop-v0.5.13/AirHop-Center_aarch64.app.tar.gz",
  publishedAt: "2026-09-11T12:00:00.000Z",
};
test("update manifest advertises only the built architecture with its signature", () => {
  const result = makeAirhopUpdaterManifest(input);
  assert.deepEqual(Object.keys(result.platforms), ["darwin-aarch64"]);
  assert.equal(result.platforms["darwin-aarch64"].signature, signature);
});
test("stable channel rejects downgrade, reused and prerelease versions", () => {
  for (const version of ["0.5.12", "0.5.11", "0.5.14-beta.1"])
    assert.throws(() => makeAirhopUpdaterManifest({ ...input, version }));
  assert.equal(
    makeAirhopUpdaterManifest({ ...input, version: "0.6.0" }).version,
    "0.6.0",
  );
});
test("unsigned, mutable and insecure packages cannot enter the update feed", () => {
  assert.throws(() =>
    makeAirhopUpdaterManifest({ ...input, signature: "deadbeef" }),
  );
  for (const url of [
    input.url.replace("https:", "http:"),
    input.url.replace("github.com", "example.com"),
    "https://github.com/makeev11/airhub-center/releases/latest/download/app.app.tar.gz",
  ])
    assert.throws(() => makeAirhopUpdaterManifest({ ...input, url }));
});
