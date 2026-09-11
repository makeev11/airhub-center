import assert from "node:assert/strict";

function versionParts(version) {
  assert(
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version),
    "The stable update channel requires a numeric x.y.z version",
  );
  return version.split(".").map(BigInt);
}

/** Publish one supported architecture only; do not advertise missing packages. */
export function makeAirhopUpdaterManifest({
  version,
  url,
  signature,
  publishedAt,
  previousVersion,
}) {
  const parts = versionParts(version);
  if (previousVersion) {
    const previous = versionParts(previousVersion);
    const changed = parts.findIndex((part, index) => part !== previous[index]);
    assert(
      changed >= 0 && parts[changed] > previous[changed],
      "Refusing a reused version or downgrade",
    );
  }
  const archive = new URL(url);
  assert(
    archive.protocol === "https:" &&
      archive.hostname === "github.com" &&
      !archive.username &&
      !archive.password &&
      !archive.search &&
      !archive.hash &&
      /^\/[^/]+\/[^/]+\/releases\/download\/[^/]+\/[^/]+\.app\.tar\.gz$/.test(
        archive.pathname,
      ),
    "Update archive must be an immutable GitHub release asset",
  );
  const decoded = Buffer.from(signature.trim(), "base64").toString("utf8");
  const lines = decoded.trim().split(/\r?\n/);
  assert(
    lines.length === 4 &&
      lines[0].startsWith("untrusted comment:") &&
      lines[2].startsWith("trusted comment:") &&
      Buffer.from(lines[1], "base64").length === 74 &&
      Buffer.from(lines[3], "base64").length === 64,
    "A complete Tauri signature is required (not a checksum)",
  );
  assert(
    new Date(publishedAt).toISOString() === publishedAt,
    "Use an ISO UTC timestamp",
  );
  return {
    version,
    notes: `AirHop Center ${version}`,
    pub_date: publishedAt,
    platforms: {
      "darwin-aarch64": { url: archive.href, signature: signature.trim() },
    },
  };
}
