import assert from "node:assert/strict";

/** Explicit opt-in for signed Center updates; ordinary local builds stay offline. */
export function airhopUpdaterConfig(env = process.env) {
  const pubkey = env.AIRHOP_UPDATER_PUBLIC_KEY?.trim();
  const endpoint = env.AIRHOP_UPDATER_ENDPOINT?.trim();
  if (!pubkey && !endpoint) return null;
  assert(
    pubkey && endpoint,
    "Configure both AIRHOP_UPDATER_PUBLIC_KEY and AIRHOP_UPDATER_ENDPOINT",
  );
  const url = new URL(endpoint);
  assert(
    url.protocol === "https:" && !url.username && !url.password && !url.hash,
    "Updater endpoint must be HTTPS without credentials or a fragment",
  );
  return { pubkey, endpoints: [url.href] };
}
