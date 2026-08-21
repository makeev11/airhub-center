import { isJoinPolicyDiscoveryCandidate } from "@/shared/api/invites";

const RESOLVE_PATH = "/api/hq/v1/activation/resolve";
const REQUEST_TIMEOUT_MS = 10_000;
const SHA256 = /^[0-9a-f]{64}$/u;

type ActivationDiscoveryEnv = ImportMetaEnv & {
  readonly VITE_AIRHOP_HQ_API_URL?: string;
};

type ActivationDiscoveryResponse = {
  relayUrl: string;
};

function configuredApiUrl(): string | null {
  const value = (import.meta.env as ActivationDiscoveryEnv | undefined)
    ?.VITE_AIRHOP_HQ_API_URL;
  return value?.trim() || null;
}

function resolveEndpoint(apiUrl: string): URL {
  const endpoint = new URL(RESOLVE_PATH, apiUrl);
  const isLocalHttp =
    endpoint.protocol === "http:" &&
    (endpoint.hostname === "localhost" || endpoint.hostname === "127.0.0.1");
  if (
    (endpoint.protocol !== "https:" && !isLocalHttp) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("AirHop activation service is not configured correctly");
  }
  return endpoint;
}

/** Whether this build can discover a tenant Center from a bare owner code. */
export function hasAirHopActivationDiscovery(): boolean {
  return configuredApiUrl() !== null;
}

/**
 * Resolve only the Center address for an owner code.
 *
 * The bearer code itself is never sent to HQ. HQ receives a one-way fingerprint
 * and returns no organization or customer data; the signed claim still goes
 * directly from this device to the resolved Center.
 */
export async function resolveAirHopActivationRelay(
  code: string,
  options: {
    apiUrl?: string;
    fetchImpl?: typeof fetch;
    timeoutMs?: number;
  } = {},
): Promise<string> {
  const apiUrl = options.apiUrl ?? configuredApiUrl();
  if (!apiUrl) {
    throw new Error("AirHop activation service is not configured");
  }
  const endpoint = resolveEndpoint(apiUrl);
  const fingerprint = await activationCodeFingerprint(code);
  const response = await (options.fetchImpl ?? fetch)(endpoint, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fingerprint }),
    cache: "no-store",
    credentials: "omit",
    redirect: "error",
    referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    if (response.status === 404 || response.status === 410) {
      throw new Error("invalid activation code");
    }
    throw new Error("AirHop activation service connection failed");
  }

  const value = (await response.json()) as Partial<ActivationDiscoveryResponse>;
  if (
    typeof value.relayUrl !== "string" ||
    !isJoinPolicyDiscoveryCandidate(value.relayUrl)
  ) {
    throw new Error("AirHop activation service returned an invalid address");
  }
  const relay = new URL(value.relayUrl);
  const isLocalWs =
    relay.protocol === "ws:" &&
    (relay.hostname === "localhost" || relay.hostname === "127.0.0.1");
  if (relay.protocol !== "wss:" && !isLocalWs) {
    throw new Error("AirHop activation service returned an insecure address");
  }
  return value.relayUrl;
}

/** Stable public lookup fingerprint. The secret code remains on the device. */
export async function activationCodeFingerprint(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code.trim()),
  );
  const value = Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
  if (!SHA256.test(value)) {
    throw new Error("Could not fingerprint the activation code");
  }
  return value;
}
