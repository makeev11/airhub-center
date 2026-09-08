import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const repositoryRoot = fileURLToPath(new URL("../../", import.meta.url));

function readJson(root, path) {
  return JSON.parse(readFileSync(resolve(root, path), "utf8"));
}

function packageVersion(source, name) {
  return source
    .split(/^\[\[?package\]?\]\s*$/m)
    .find((section) => section.match(/^name = "([^"]+)"$/m)?.[1] === name)
    ?.match(/^version = "([^"]+)"$/m)?.[1];
}

/** Require the JS, native bundle, Rust package and lockfile to agree. */
export function readDesktopVersion(root = repositoryRoot) {
  const versions = [
    readJson(root, "desktop/package.json").version,
    readJson(root, "desktop/src-tauri/tauri.conf.json").version,
    ...["Cargo.toml", "Cargo.lock"].map((name) =>
      packageVersion(
        readFileSync(resolve(root, "desktop/src-tauri", name), "utf8"),
        "buzz-desktop",
      ),
    ),
  ];
  if (
    typeof versions[0] !== "string" ||
    !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(versions[0]) ||
    versions.some((version) => version !== versions[0])
  ) {
    throw new Error(
      `Desktop release versions disagree: ${JSON.stringify(versions)}`,
    );
  }
  return versions[0];
}

/** Resolve one committed, clean source identity; never label dirty code as HEAD. */
export function readReleaseIdentity(root = repositoryRoot, expectedCommit) {
  const git = (...args) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const commit = git("rev-parse", "HEAD");
  if (
    !/^[a-f0-9]{40}$/.test(expectedCommit ?? "") ||
    commit !== expectedCommit
  ) {
    throw new Error("Release requires the exact expected full Git commit SHA");
  }
  if (git("status", "--porcelain=v1", "--untracked-files=all")) {
    throw new Error(
      "Release requires a clean checkout, including staged and untracked files",
    );
  }
  const version = readDesktopVersion(root);
  const migrations = readdirSync(resolve(root, "migrations")).map((name) =>
    Number(name.match(/^(\d+)_.*\.sql$/)?.[1] ?? 0),
  );
  const databaseMigration = Math.max(0, ...migrations);
  if (databaseMigration === 0) throw new Error("No database migrations found");
  return {
    schemaVersion: 1,
    product: "AirHop Center",
    releaseId: `airhop-center-${version}-${commit.slice(0, 12)}`,
    version,
    commit,
    tree: git("rev-parse", "HEAD^{tree}"),
    databaseMigration,
  };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    if (process.argv[2] === "--check-version") {
      console.log(`AirHop Center desktop version: ${readDesktopVersion()}`);
    } else {
      console.log(
        JSON.stringify(
          readReleaseIdentity(repositoryRoot, process.argv[2]),
          null,
          2,
        ),
      );
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
