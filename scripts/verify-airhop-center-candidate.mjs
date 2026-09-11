// Verify frozen artifacts independently of the mutable desktop/target directory.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  readReleaseIdentity,
  repositoryRoot,
} from "../desktop/scripts/airhop-release-identity.mjs";

assert(
  process.argv[2],
  "Usage: node scripts/verify-airhop-center-candidate.mjs <directory> [--require-current]",
);
const output = resolve(process.argv[2]);
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const identity = json(join(output, "release.json"));
const receipt = json(join(output, "artifacts.json"));
for (const [key, value] of Object.entries(identity))
  assert.deepEqual(receipt[key], value, key);
assert.equal(receipt.status, "built-not-deployed");
assert.equal(hash(join(output, "source.tgz")), receipt.sourceArchiveSha256);
assert.equal(
  hash(join(output, "public-web.tgz")),
  receipt.publicWebArchiveSha256,
);
assert.equal(
  hash(join(output, "Dockerfile.center-release")),
  receipt.dockerfileSha256,
);
assert.equal(hash(join(output, "base-image.json")), receipt.baseImageSha256);
const app = join(output, "AirHop Center.app");
assert.deepEqual(
  json(join(app, "Contents/Resources/airhop-release.json")),
  identity,
);
assert.deepEqual(
  json(join(output, "public-web/airhop-release.json")),
  identity,
);

function actualFiles(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return actualFiles(path, relativePath);
    assert(entry.isFile(), `Non-regular artifact: ${relativePath}`);
    return [relativePath];
  });
}
function verifyFiles(directory, files) {
  assert.deepEqual(
    actualFiles(directory).sort(),
    files.map((file) => file.path).sort(),
  );
  for (const file of files) {
    assert(!file.path.startsWith("/") && !file.path.split("/").includes(".."));
    const path = join(directory, file.path);
    assert(lstatSync(path).isFile());
    assert.equal(hash(path), file.sha256, `Artifact changed: ${file.path}`);
  }
}
verifyFiles(app, receipt.macos.files);
verifyFiles(join(output, "public-web"), receipt.publicWeb.files);
if (receipt.artifactSchemaVersion !== undefined) {
  assert.equal(
    receipt.artifactSchemaVersion,
    2,
    "Unsupported artifact receipt schema",
  );
  assert.equal(
    hash(join(output, "tauri.candidate.json")),
    receipt.nativeConfigSha256,
  );
  assert.deepEqual(
    json(join(output, "native-web/airhop-release.json")),
    identity,
  );
  verifyFiles(join(output, "native-web"), receipt.nativeWeb.files);
}
if (process.argv[3] === "--require-current") {
  assert.deepEqual(
    readReleaseIdentity(repositoryRoot, identity.commit),
    identity,
  );
} else {
  assert.equal(process.argv[3], undefined, "Unknown verification option");
}
console.log(
  JSON.stringify(
    {
      releaseId: identity.releaseId,
      commit: identity.commit,
      verified: true,
      installedOrDeployed: false,
    },
    null,
    2,
  ),
);
