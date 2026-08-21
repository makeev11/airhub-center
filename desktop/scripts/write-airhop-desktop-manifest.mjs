import { writeFileSync } from "node:fs";

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const SHA256 = /^[0-9a-f]{64}$/u;

function fail(message) {
  console.error(`Error: ${message}`);
  process.exit(1);
}

function argumentsFrom(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || value === undefined) {
      fail("arguments must be provided as --name value pairs");
    }
    values.set(key.slice(2), value);
  }
  return values;
}

function required(values, name) {
  const value = values.get(name);
  if (!value) fail(`--${name} is required`);
  return value;
}

function httpsUrl(raw, name) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    fail(`--${name} must be a valid URL`);
  }
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.hash !== ""
  ) {
    fail(`--${name} must be a public HTTPS URL`);
  }
  return url.toString();
}

const values = argumentsFrom(process.argv.slice(2));
const version = required(values, "version");
if (!SEMVER.test(version)) fail("--version must be semantic versioning");

const publishedAt = required(values, "published-at");
const parsedPublishedAt = new Date(publishedAt);
if (
  !Number.isFinite(parsedPublishedAt.getTime()) ||
  parsedPublishedAt.toISOString() !== publishedAt
) {
  fail("--published-at must be an ISO-8601 UTC timestamp");
}

const macosSha256 = required(values, "macos-sha256");
if (!SHA256.test(macosSha256)) {
  fail("--macos-sha256 must contain 64 lowercase hexadecimal characters");
}

const output = required(values, "output");
const manifest = {
  version,
  publishedAt,
  macos: {
    url: httpsUrl(required(values, "macos-url"), "macos-url"),
    sha256: macosSha256,
    minimumOs: required(values, "macos-minimum-os"),
  },
};

writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, {
  encoding: "utf8",
  mode: 0o644,
});
console.log(`Wrote ${output}`);
