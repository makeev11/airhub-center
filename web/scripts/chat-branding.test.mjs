import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { inflateSync } from "node:zlib";
import test from "node:test";
import { chatTextIcon } from "./chat-text-icon.mjs";

test("rejected logo cannot return through header, login or install assets", () => {
  const root = new URL("../", import.meta.url);
  for (const file of [
    "src/features/chat/ui/ChatWorkspace.tsx",
    "src/features/chat/ui/ConnectChat.tsx",
  ]) {
    const source = readFileSync(new URL(file, root), "utf8");
    assert.ok(
      !source.includes("<img"),
      `${file}: header/login must stay text-only`,
    );
    assert.ok(!source.includes("chat-icon.svg"));
  }
  assert.ok(!existsSync(new URL("public/chat-icon.svg", root)));
  const config = readFileSync(new URL("vite.config.ts", root), "utf8");
  assert.ok(
    !config.includes("desktop/public/airhop"),
    "Do not reimport desktop branding",
  );
  const manifest = JSON.parse(
    readFileSync(new URL("public/chat.webmanifest", root), "utf8"),
  );
  assert.deepEqual(
    manifest.icons.map((icon) => icon.src),
    ["/chat-assets/chat-text-192.png", "/chat-assets/chat-text-512.png"],
  );
});

test("installation tiles are valid text-only monochrome PNGs at all required sizes", () => {
  for (const size of [180, 192, 512]) {
    const png = chatTextIcon(size);
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
    const bytes = inflateSync(png.subarray(41, 41 + png.readUInt32BE(33)));
    assert.equal(bytes.length, size * (size * 3 + 1));
    const colors = new Set();
    for (let y = 0; y < size; y++) {
      assert.equal(bytes[y * (size * 3 + 1)], 0);
      for (let x = 0; x < size; x++)
        colors.add(bytes[y * (size * 3 + 1) + 1 + x * 3]);
    }
    assert.deepEqual([...colors].sort(), [255, 35]);
  }
});
