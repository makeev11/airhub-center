import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { makeAirhopUpdaterManifest } from "./airhop-updater-manifest.mjs";

const [version, url, signaturePath, output, previousPath] =
  process.argv.slice(2);
assert(
  output,
  "Usage: <version> <immutable-archive-url> <signature-file> <output> [previous-manifest]",
);
const manifest = makeAirhopUpdaterManifest({
  version,
  url,
  signature: readFileSync(signaturePath, "utf8"),
  publishedAt: new Date().toISOString(),
  previousVersion: previousPath
    ? JSON.parse(readFileSync(previousPath, "utf8")).version
    : undefined,
});
writeFileSync(output, JSON.stringify(manifest, null, 2) + "\n", { flag: "wx" });
