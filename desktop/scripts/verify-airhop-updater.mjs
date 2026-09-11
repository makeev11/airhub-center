import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/** Verify Tauri's base64-wrapped Minisign envelope with Node's Ed25519 implementation.
 * The layout follows the pinned tauri-plugin-updater/minisign-verify dependencies:
 * algorithm + key id + signature, then a separately signed trusted comment.
 * Tauri verifies the same envelope again before installation.
 */
export function verifyAirhopUpdater(data, encodedSignature, encodedPublicKey) {
  const keyLines = Buffer.from(encodedPublicKey.trim(), "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  const lines = Buffer.from(encodedSignature.trim(), "base64")
    .toString("utf8")
    .trim()
    .split(/\r?\n/);
  assert(
    keyLines.length === 2 && lines.length === 4,
    "Invalid updater signature envelope",
  );
  const key = Buffer.from(keyLines[1], "base64");
  const signed = Buffer.from(lines[1], "base64");
  const global = Buffer.from(lines[3], "base64");
  assert(
    key.length === 42 && signed.length === 74 && global.length === 64,
    "Invalid signature sizes",
  );
  assert(
    ["Ed", "ED"].includes(key.subarray(0, 2).toString()) &&
      ["Ed", "ED"].includes(signed.subarray(0, 2).toString()),
    "Unsupported signature algorithm",
  );
  assert(
    key.subarray(2, 10).equals(signed.subarray(2, 10)),
    "Unexpected signing key",
  );
  assert(lines[2].startsWith("trusted comment: "), "Missing trusted comment");
  const publicKey = createPublicKey({
    format: "der",
    type: "spki",
    key: Buffer.concat([
      Buffer.from("302a300506032b6570032100", "hex"),
      key.subarray(10),
    ]),
  });
  const payload =
    signed.subarray(0, 2).toString() === "ED"
      ? createHash("blake2b512").update(data).digest()
      : data;
  assert(
    verify(null, payload, publicKey, signed.subarray(10)),
    "Updater archive signature verification failed",
  );
  assert(
    verify(
      null,
      Buffer.concat([signed.subarray(10), Buffer.from(lines[2].slice(17))]),
      publicKey,
      global,
    ),
    "Updater trusted comment verification failed",
  );
  return true;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [archive, signature] = process.argv.slice(2);
  assert(
    archive && signature && process.env.AIRHOP_UPDATER_PUBLIC_KEY,
    "Usage: <archive> <signature> with AIRHOP_UPDATER_PUBLIC_KEY",
  );
  verifyAirhopUpdater(
    readFileSync(archive),
    readFileSync(signature, "utf8"),
    process.env.AIRHOP_UPDATER_PUBLIC_KEY,
  );
  console.log("Updater archive signature verified");
}
