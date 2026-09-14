// Build the prepared local/demo candidate. Deliberately no install or network
// deployment; dependency/tool downloads performed by the build tools are normal.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  openSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { join, resolve } from "node:path";
import { airhopUpdaterConfig } from "../desktop/scripts/airhop-updater-config.mjs";
import {
  readReleaseIdentity,
  repositoryRoot,
} from "../desktop/scripts/airhop-release-identity.mjs";

assert.equal(
  process.platform,
  "darwin",
  "This local candidate builder requires macOS",
);
assert(
  process.argv[2],
  "Usage: node scripts/build-airhop-center-candidate.mjs <prepared-directory>",
);
const output = resolve(process.argv[2]);
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const identity = json(join(output, "release.json"));
const source = json(join(output, "source-manifest.json"));
const hash = (path) =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
assert.deepEqual(
  readReleaseIdentity(repositoryRoot, identity.commit),
  identity,
);
assert.equal(source.commit, identity.commit);
assert.equal(hash(join(output, "source.tgz")), source.sourceArchiveSha256);
assert(
  !existsSync(join(output, "build-started.json")),
  "Candidate already attempted; prepare a new directory instead of overwriting it",
);
writeFileSync(
  join(output, "build-started.json"),
  JSON.stringify({ ...identity, startedAt: new Date().toISOString() }, null, 2),
  { flag: "wx" },
);

const updaterDefaults = json(join(repositoryRoot, "deploy/airhop/desktop-updater.json"));
const updater = airhopUpdaterConfig({
  AIRHOP_UPDATER_PUBLIC_KEY: updaterDefaults.publicKey,
  AIRHOP_UPDATER_ENDPOINT: updaterDefaults.endpoint,
  ...process.env,
});
const env = {
  ...process.env,
  AIRHOP_RELEASE_COMMIT: identity.commit,
  VITE_AIRHOP_PUBLIC_WEB: "0",
  VITE_AIRHOP_PUBLIC_BOOKING_RUNTIME: "",
  BUZZ_UPDATER_PUBLIC_KEY: updater?.pubkey ?? "",
  BUZZ_UPDATER_ENDPOINT: updater?.endpoints[0] ?? "",
};
const desktop = join(repositoryRoot, "desktop");
function run(name, command, args, cwd = repositoryRoot, extraEnv = {}) {
  console.log(`${name}: ${command} ${args.join(" ")}`);
  const fd = openSync(join(output, `${name}.log`), "wx");
  try {
    execFileSync(command, args, {
      cwd,
      env: { ...env, ...extraEnv },
      stdio: ["ignore", fd, fd],
    });
  } finally {
    closeSync(fd);
  }
}
run("sidecars", "cargo", [
  "build",
  "--release",
  "--locked",
  "-p",
  "buzz-acp",
  "-p",
  "buzz-agent",
  "-p",
  "buzz-dev-mcp",
  "-p",
  "buzz-cli",
]);
run("bundle-sidecars", "bash", ["scripts/bundle-sidecars.sh"]);
run(
  "public-web",
  "pnpm",
  [
    "exec",
    "vite",
    "build",
    "--mode",
    "production",
    "--outDir",
    join(output, "public-web"),
  ],
  desktop,
  {
    VITE_AIRHOP_PUBLIC_WEB: "1",
    VITE_AIRHOP_PUBLIC_BOOKING_RUNTIME: "server",
  },
);
assert.deepEqual(
  json(join(output, "public-web/airhop-release.json")),
  identity,
);
// Keep Tauri's embedded assets independent of desktop/dist. A concurrent CI
// build may legitimately replace that shared development output directory.
const nativeWeb = join(output, "native-web");
run("native-typecheck", "pnpm", ["exec", "tsc", "--noEmit"], desktop);
run(
  "native-web",
  "pnpm",
  ["exec", "vite", "build", "--mode", "production", "--outDir", nativeWeb],
  desktop,
);
assert.deepEqual(json(join(nativeWeb, "airhop-release.json")), identity);
const nativeWebFiles = fileManifest(nativeWeb);
const nativeConfig = join(output, "tauri.candidate.json");
writeFileSync(
  nativeConfig,
  JSON.stringify(
    {
      build: { beforeBuildCommand: null, frontendDist: nativeWeb },
      ...(updater ? { plugins: { updater } } : {}),
    },
    null,
    2,
  ),
  { flag: "wx" },
);
run(
  "native",
  "pnpm",
  [
    "exec",
    "tauri",
    "build",
    "--bundles",
    "app",
    "--config",
    "src-tauri/tauri.airhop-release.conf.json",
    "--config",
    nativeConfig,
    "--",
    "--locked",
  ],
  desktop,
);
assert.deepEqual(
  fileManifest(nativeWeb),
  nativeWebFiles,
  "Native frontend changed during compilation",
);
assert.deepEqual(
  readReleaseIdentity(repositoryRoot, identity.commit),
  identity,
);

const builtApp = join(
  desktop,
  "src-tauri/target/release/bundle/macos/AirHop Center.app",
);
const app = join(output, "AirHop Center.app");
run("copy-app", "ditto", [builtApp, app]);
const plist = join(app, "Contents/Info.plist");
const plistValue = (key) =>
  execFileSync("/usr/libexec/PlistBuddy", ["-c", `Print :${key}`, plist], {
    encoding: "utf8",
  }).trim();
assert.equal(plistValue("CFBundleIdentifier"), "ru.airhop.centers.app");
assert.equal(plistValue("CFBundleExecutable"), "airhop-center");
assert.equal(plistValue("CFBundleShortVersionString"), identity.version);
writeFileSync(
  join(app, "Contents/Resources/airhop-release.json"),
  `${JSON.stringify(identity, null, 2)}\n`,
  { flag: "wx" },
);
const sidecars = ["buzz", "buzz-acp", "buzz-agent", "airhop-agent-mcp"];
run("sign-sidecars", "codesign", [
  "--force",
  "--sign",
  "-",
  "--timestamp=none",
  ...sidecars.map((name) => join(app, "Contents/MacOS", name)),
]);
run("sign-app", "codesign", [
  "--force",
  "--sign",
  "-",
  "--timestamp=none",
  "--entitlements",
  join(desktop, "src-tauri/Entitlements.plist"),
  app,
]);
run("verify-signature", "codesign", [
  "--verify",
  "--deep",
  "--strict",
  "--verbose=2",
  app,
]);
run(
  "archive-public-web",
  "tar",
  [
    "--no-xattrs",
    "--disable-copyfile",
    "-czf",
    join(output, "public-web.tgz"),
    "-C",
    output,
    "public-web",
  ],
  repositoryRoot,
  { COPYFILE_DISABLE: "1" },
);

function fileManifest(directory, prefix = "") {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => a.name.localeCompare(b.name))
    .flatMap((entry) => {
      const path = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) return fileManifest(path, relativePath);
      assert(entry.isFile(), `Unexpected non-regular artifact: ${path}`);
      return [{ path: relativePath, sha256: hash(path) }];
    });
}
assert.deepEqual(
  readReleaseIdentity(repositoryRoot, identity.commit),
  identity,
);
const receipt = {
  ...identity,
  artifactSchemaVersion: 2,
  status: "built-not-deployed",
  scope: "demo/local candidate; not a notarized public release",
  builtAt: new Date().toISOString(),
  sourceArchiveSha256: source.sourceArchiveSha256,
  publicWebArchiveSha256: hash(join(output, "public-web.tgz")),
  dockerfileSha256: hash(join(output, "Dockerfile.center-release")),
  baseImageSha256: hash(join(output, "base-image.json")),
  nativeConfigSha256: hash(nativeConfig),
  nativeWeb: { files: nativeWebFiles },
  macos: { signing: "ad-hoc", files: fileManifest(app) },
  publicWeb: { files: fileManifest(join(output, "public-web")) },
};
writeFileSync(
  join(output, "artifacts.json"),
  `${JSON.stringify(receipt, null, 2)}\n`,
  { flag: "wx" },
);
console.log(
  JSON.stringify(
    { releaseId: identity.releaseId, output, status: receipt.status },
    null,
    2,
  ),
);
