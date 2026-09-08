// Local-only preparation. No upload, install, service restart, tag or Git push.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  readReleaseIdentity,
  repositoryRoot,
} from "../desktop/scripts/airhop-release-identity.mjs";

const baseImage = process.argv[2];
if (!/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/.test(baseImage ?? "")) {
  throw new Error(
    "Usage: node scripts/prepare-airhop-center-release.mjs <existing-demo-image@sha256:digest>",
  );
}
const git = (...args) =>
  execFileSync("git", args, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
  });
const commit = git("rev-parse", "HEAD").trim();
const identity = readReleaseIdentity(repositoryRoot, commit);
const roots = [
  "Cargo.toml",
  "Cargo.lock",
  "Dockerfile",
  ".dockerignore",
  ".gitattributes",
  "package.json",
  "pnpm-lock.yaml",
  "pnpm-workspace.yaml",
  "preview-features.json",
  "crates",
  "migrations",
  "web",
  "admin-web",
  "desktop",
  "integrations",
  "examples",
  "patches",
  "deploy/airhop",
  "scripts",
  "docs",
];
const entries = git("ls-tree", "-r", "-z", commit, "--", ...roots)
  .split("\0")
  .filter(Boolean)
  .map((entry) => {
    const separator = entry.indexOf("\t");
    const [mode, type, blob] = entry.slice(0, separator).split(" ");
    return { mode, type, blob, path: entry.slice(separator + 1) };
  })
  .filter(
    ({ path }) =>
      !path
        .split("/")
        .some(
          (part) =>
            part.startsWith(".env") ||
            /^(?:secrets?|node_modules|target|dist|test-results|playwright-report)$/.test(
              part,
            ),
        ) && !/\.(?:pem|key|p12|pfx|sqlite|db)$/.test(path),
  );
const files = entries.map((entry) => entry.path);
assert(
  files.every((path) => !/[\r\n]/.test(path)),
  "Unsupported source filename",
);
// Compare raw bytes to committed blobs, without Git clean/line-ending filters.
// Use stdin, not thousands of argv entries (macOS ARG_MAX is limited).
const blobs = execFileSync(
  "git",
  ["hash-object", "--no-filters", "--stdin-paths"],
  {
    cwd: repositoryRoot,
    encoding: "utf8",
    input: `${files.map((path) => JSON.stringify(path)).join("\n")}\n`,
  },
)
  .trim()
  .split("\n");
assert.equal(blobs.length, entries.length);
entries.forEach((entry, index) => {
  assert.equal(entry.type, "blob");
  assert(
    ["100644", "100755"].includes(entry.mode),
    `Non-regular Git source: ${entry.path}`,
  );
  assert.equal(
    blobs[index],
    entry.blob,
    `Working bytes differ from commit: ${entry.path}`,
  );
});
const sha256 = (data) => createHash("sha256").update(data).digest("hex");
const manifest = files.map((path) => {
  assert(!path.startsWith("/") && !path.split("/").includes(".."));
  assert(
    lstatSync(resolve(repositoryRoot, path)).isFile(),
    `Not a regular source file: ${path}`,
  );
  return { path, sha256: sha256(readFileSync(resolve(repositoryRoot, path))) };
});
const output = mkdtempSync(join(tmpdir(), `${identity.releaseId}-`));
execFileSync(
  "tar",
  [
    "--no-xattrs",
    "--disable-copyfile",
    "-czf",
    join(output, "source.tgz"),
    "--null",
    "-T",
    "-",
  ],
  {
    cwd: repositoryRoot,
    input: `${files.join("\0")}\0`,
    env: { ...process.env, COPYFILE_DISABLE: "1" },
  },
);
const archived = execFileSync("tar", ["-tzf", join(output, "source.tgz")], {
  encoding: "utf8",
  maxBuffer: 16 * 1024 * 1024,
})
  .split("\n")
  .filter((path) => path && !path.endsWith("/"))
  .sort();
assert.deepEqual(
  archived,
  [...files].sort(),
  "Archive must contain exactly the selected committed sources",
);
// Check archived bytes too: export-subst/line-ending transforms must not silently
// diverge from the bytes used by the native/public builds in this checkout.
const archivedRoot = join(output, "source");
mkdirSync(archivedRoot);
execFileSync("tar", ["-xzf", join(output, "source.tgz"), "-C", archivedRoot]);
for (const file of manifest) {
  assert.equal(
    sha256(readFileSync(join(archivedRoot, file.path))),
    file.sha256,
    `Archive differs: ${file.path}`,
  );
}
const sourceArchiveSha256 = sha256(readFileSync(join(output, "source.tgz")));
const writeJson = (name, data) =>
  writeFileSync(join(output, name), `${JSON.stringify(data, null, 2)}\n`, {
    flag: "wx",
  });
writeJson("release.json", identity);
writeJson("source-manifest.json", {
  ...identity,
  sourceArchiveSha256,
  files: manifest,
});

const dockerfile = readFileSync(
  resolve(repositoryRoot, "Dockerfile"),
  "utf8",
).replace(
  "FROM chef AS builder\n",
  "FROM chef AS builder\nENV CARGO_BUILD_JOBS=1\n",
);
assert(dockerfile.includes("ENV CARGO_BUILD_JOBS=1"));
writeFileSync(
  join(output, "Dockerfile.center-release"),
  `${dockerfile}
# Demo-only: preserve the pinned pilot and previously referenced hashed assets.
FROM ${baseImage} AS airhop-center-candidate
COPY --from=stripped-binaries /build/target/release/buzz-relay /usr/local/bin/buzz-relay
COPY --from=stripped-binaries /build/target/release/buzz-admin /usr/local/bin/buzz-admin
COPY --from=stripped-binaries /build/target/release/buzz-pair-relay /usr/local/bin/buzz-pair-relay
COPY public-web/ /srv/airhop/public-web/
COPY release.json /srv/airhop/center-release.json
LABEL ru.airhop.release="${identity.releaseId}" \\
      org.opencontainers.image.version="${identity.version}" \\
      org.opencontainers.image.revision="${identity.commit}" \\
      ru.airhop.source-archive-sha256="${sourceArchiveSha256}"
`,
  { flag: "wx" },
);
readReleaseIdentity(repositoryRoot, identity.commit);
console.log(
  JSON.stringify(
    {
      ...identity,
      output,
      sourceArchiveSha256,
      sourceFiles: files.length,
      baseImage,
    },
    null,
    2,
  ),
);
