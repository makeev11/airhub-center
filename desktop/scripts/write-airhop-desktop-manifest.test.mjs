import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const SCRIPT = new URL("./write-airhop-desktop-manifest.mjs", import.meta.url);
const SHA = "ab".repeat(32);

test("writes a macOS-only public desktop release manifest", async () => {
  const directory = await mkdtemp(join(tmpdir(), "airhop-release-"));
  const output = join(directory, "latest.json");
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT.pathname,
      "--version",
      "0.6.0",
      "--published-at",
      "2026-08-21T12:00:00.000Z",
      "--macos-url",
      "https://github.com/makeev11/airhub-center/releases/download/airhop-desktop-v0.6.0/AirHop-Center_0.6.0_aarch64.dmg",
      "--macos-sha256",
      SHA,
      "--macos-minimum-os",
      "macOS 12 or newer, Apple Silicon",
      "--output",
      output,
    ],
    { encoding: "utf8" },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await readFile(output, "utf8")), {
    version: "0.6.0",
    publishedAt: "2026-08-21T12:00:00.000Z",
    macos: {
      url: "https://github.com/makeev11/airhub-center/releases/download/airhop-desktop-v0.6.0/AirHop-Center_0.6.0_aarch64.dmg",
      sha256: SHA,
      minimumOs: "macOS 12 or newer, Apple Silicon",
    },
  });
});

test("rejects non-HTTPS artifacts and malformed hashes", () => {
  const result = spawnSync(
    process.execPath,
    [
      SCRIPT.pathname,
      "--version",
      "0.6.0",
      "--published-at",
      "2026-08-21T12:00:00.000Z",
      "--macos-url",
      "http://example.com/AirHop.dmg",
      "--macos-sha256",
      "short",
      "--macos-minimum-os",
      "macOS 12",
      "--output",
      "/tmp/airhop-invalid-release.json",
    ],
    { encoding: "utf8" },
  );

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /sha256/i);
});
