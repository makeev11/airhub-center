import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  readDesktopVersion,
  readReleaseIdentity,
  validateDemoBase,
} from "./airhop-release-identity.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "airhop-release-identity-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, value) => writeFileSync(join(root, path), value);
  mkdirSync(join(root, "desktop/src-tauri"), { recursive: true });
  mkdirSync(join(root, "migrations"));
  write("desktop/package.json", '{"version":"0.5.6"}\n');
  write("desktop/src-tauri/tauri.conf.json", '{"version":"0.5.6"}\n');
  write(
    "desktop/src-tauri/Cargo.toml",
    '[workspace]\nmembers = []\n\n[package]\nname = "buzz-desktop"\nversion = "0.5.6"\n',
  );
  write(
    "desktop/src-tauri/Cargo.lock",
    'version = 4\n\n[[package]]\nname = "other"\nversion = "9.0.0"\n\n[[package]]\nname = "buzz-desktop"\nversion = "0.5.6"\n',
  );
  write("migrations/0054_example.sql", "SELECT 1;\n");
  write(".gitignore", "dist/\n");
  const git = (...args) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  git("init", "-q");
  git("config", "user.name", "Release Test");
  git("config", "user.email", "release-test@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.hooksPath", join(root, "empty-hooks"));
  git("add", ".");
  git("commit", "-q", "-s", "-m", "test: initial release fixture");
  return { root, write, git, commit: git("rev-parse", "HEAD") };
}

test("local Docker image tag and config ID are separate identities", () => {
  assert.deepEqual(
    validateDemoBase(
      "airhub-center-relay:demo-pinned",
      `sha256:${"a".repeat(64)}`,
    ),
    {
      image: "airhub-center-relay:demo-pinned",
      imageId: `sha256:${"a".repeat(64)}`,
    },
  );
});

for (const image of [
  undefined,
  "airhub-center-relay",
  "airhub-center-relay:latest",
  `airhub-center-relay@sha256:${"a".repeat(64)}`,
]) {
  test(`rejects ambiguous or misidentified Docker base: ${image}`, () => {
    assert.throws(
      () => validateDemoBase(image, `sha256:${"a".repeat(64)}`),
      /separate sha256 image ID/,
    );
  });
}

test("Docker base requires a full config ID", () => {
  assert.throws(() =>
    validateDemoBase("airhub-center-relay:demo-pinned", "4a7c892f03ff"),
  );
});

test("all four manifests must carry the same version", (t) => {
  const { root, write } = fixture(t);
  assert.equal(readDesktopVersion(root), "0.5.6");
  write(
    "desktop/src-tauri/Cargo.lock",
    '[[package]]\nname = "buzz-desktop"\nversion = "0.5.5"\n',
  );
  assert.throws(() => readDesktopVersion(root), /versions disagree/);
});

test("missing native package cannot masquerade as another dependency", (t) => {
  const { root, write } = fixture(t);
  write(
    "desktop/src-tauri/Cargo.toml",
    '[package]\nname = "another-app"\nversion = "0.5.6"\n',
  );
  assert.throws(() => readDesktopVersion(root), /versions disagree/);
});

test("identity includes exact commit, tree and database migration", (t) => {
  const { root, commit, git } = fixture(t);
  assert.deepEqual(readReleaseIdentity(root, commit), {
    schemaVersion: 1,
    product: "AirHop Center",
    releaseId: `airhop-center-0.5.6-${commit.slice(0, 12)}`,
    version: "0.5.6",
    commit,
    tree: git("rev-parse", "HEAD^{tree}"),
    databaseMigration: 54,
  });
});

test("missing, shortened and stale commit identities are rejected", (t) => {
  const { root, commit } = fixture(t);
  for (const expected of [undefined, commit.slice(0, 12), "a".repeat(40)]) {
    assert.throws(() => readReleaseIdentity(root, expected), /exact expected/);
  }
});

for (const state of ["modified", "staged", "untracked", "deleted"]) {
  test(`release refuses ${state} source changes`, (t) => {
    const { root, commit, write, git } = fixture(t);
    if (state === "untracked") write("new-feature.ts", "export {};\n");
    else if (state === "deleted")
      rmSync(join(root, "migrations/0054_example.sql"));
    else {
      write("migrations/0054_example.sql", "SELECT 2;\n");
      if (state === "staged") git("add", "migrations/0054_example.sql");
    }
    assert.throws(() => readReleaseIdentity(root, commit), /clean checkout/);
  });
}

test("ignored build output does not make a committed source dirty", (t) => {
  const { root, commit, write } = fixture(t);
  mkdirSync(join(root, "dist"));
  write("dist/result.js", "build output");
  assert.equal(readReleaseIdentity(root, commit).commit, commit);
});

test("Vite binds the visible version and emitted receipt to the same identity", () => {
  const source = readFileSync(
    new URL("../vite.config.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /readReleaseIdentity\(repositoryRoot, releaseCommit\)/);
  assert.match(
    source,
    /readReleaseIdentity\(repositoryRoot, releaseIdentity.commit\)/,
  );
  assert.match(source, /fileName: "airhop-release.json"/);
  assert.match(source, /releaseIdentity\?\.commit/);
});

function candidate(t) {
  const root = mkdtempSync(join(tmpdir(), "airhop-release-artifact-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const write = (path, data) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), data);
  };
  const hash = (path) =>
    createHash("sha256")
      .update(readFileSync(join(root, path)))
      .digest("hex");
  const identity = {
    releaseId: "airhop-center-0.5.6-test",
    commit: "a".repeat(40),
    version: "0.5.6",
  };
  for (const file of [
    "release.json",
    "public-web/airhop-release.json",
    "AirHop Center.app/Contents/Resources/airhop-release.json",
  ]) {
    write(file, JSON.stringify(identity));
  }
  for (const file of [
    "source.tgz",
    "public-web.tgz",
    "Dockerfile.center-release",
    "base-image.json",
  ])
    write(file, "fixture bytes");
  write(
    "artifacts.json",
    JSON.stringify({
      ...identity,
      status: "built-not-deployed",
      sourceArchiveSha256: hash("source.tgz"),
      publicWebArchiveSha256: hash("public-web.tgz"),
      dockerfileSha256: hash("Dockerfile.center-release"),
      baseImageSha256: hash("base-image.json"),
      macos: {
        files: [
          {
            path: "Contents/Resources/airhop-release.json",
            sha256: hash(
              "AirHop Center.app/Contents/Resources/airhop-release.json",
            ),
          },
        ],
      },
      publicWeb: {
        files: [
          {
            path: "airhop-release.json",
            sha256: hash("public-web/airhop-release.json"),
          },
        ],
      },
    }),
  );
  const verify = () =>
    execFileSync(
      process.execPath,
      [
        new URL(
          "../../scripts/verify-airhop-center-candidate.mjs",
          import.meta.url,
        ).pathname,
        root,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  return { write, verify };
}

test("artifact verifier accepts matching receipts and bytes", (t) => {
  assert.equal(JSON.parse(candidate(t).verify()).verified, true);
});

for (const change of ["archive", "extra-file", "receipt"]) {
  test(`artifact verifier refuses changed ${change}`, (t) => {
    const { write, verify } = candidate(t);
    if (change === "archive") write("public-web.tgz", "different build");
    if (change === "extra-file")
      write("public-web/old-version.js", "stale code");
    if (change === "receipt")
      write("public-web/airhop-release.json", '{"version":"0.5.5"}');
    assert.throws(verify);
  });
}
