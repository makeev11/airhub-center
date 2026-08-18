import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

import type { AirhopWelcomeRole } from "./welcomeTeamLocale";

const NIP98_KIND = 27235;
const WELCOME_TEAM_PATH = "/api/airhop/agents/v1/welcome-team";
const REQUEST_TIMEOUT_MS = 15_000;
const WELCOME_ROLES = [
  "fizz",
  "administrator",
  "analyst",
  "content_marketer",
] as const satisfies readonly AirhopWelcomeRole[];

export type WelcomeTeamMembers = Readonly<Record<AirhopWelcomeRole, string>>;

export type RegisterWelcomeTeamInput = Readonly<{
  organizationId: string;
  channelId: string;
  locale: string;
  members: WelcomeTeamMembers;
}>;

export type RegisteredWelcomeTeam = RegisterWelcomeTeamInput &
  Readonly<{
    version: number;
    updatedAt: string;
  }>;

type EventSigner = (input: {
  kind: number;
  content: string;
  tags: string[][];
}) => Promise<RelayEvent>;

type WelcomeTeamRegistrarOptions = Readonly<{
  relayHttpUrl?: () => Promise<string>;
  signEvent?: EventSigner;
  fetch?: typeof globalThis.fetch;
  nonceFactory?: () => string;
}>;

function isPubkey(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{64}$/i.test(value);
}

function isWelcomeMembers(value: unknown): value is WelcomeTeamMembers {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (
    keys.length === WELCOME_ROLES.length &&
    WELCOME_ROLES.every((role) => isPubkey(record[role]))
  );
}

function parseRegisteredWelcomeTeam(value: unknown): RegisteredWelcomeTeam {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Invalid Welcome team response.");
  }
  const record = value as Record<string, unknown>;
  if (
    typeof record.organizationId !== "string" ||
    typeof record.channelId !== "string" ||
    typeof record.locale !== "string" ||
    !isWelcomeMembers(record.members) ||
    typeof record.version !== "number" ||
    !Number.isInteger(record.version) ||
    record.version < 1 ||
    typeof record.updatedAt !== "string"
  ) {
    throw new Error("Invalid Welcome team response.");
  }
  return {
    organizationId: record.organizationId,
    channelId: record.channelId,
    locale: record.locale,
    members: record.members,
    version: record.version,
    updatedAt: record.updatedAt,
  };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function errorMessage(response: Response, payload: unknown) {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return `HTTP ${response.status}`;
}

export function createWelcomeTeamRegistrar(
  options: WelcomeTeamRegistrarOptions = {},
) {
  const relayHttpUrl = options.relayHttpUrl ?? getRelayHttpUrl;
  const signEvent = options.signEvent ?? signRelayEvent;
  const fetchImplementation =
    options.fetch ?? globalThis.fetch.bind(globalThis);
  const nonceFactory = options.nonceFactory ?? (() => crypto.randomUUID());

  return async function register(
    input: RegisterWelcomeTeamInput,
  ): Promise<RegisteredWelcomeTeam> {
    if (!isWelcomeMembers(input.members)) {
      throw new Error("Welcome team registration requires exactly four roles.");
    }
    const baseUrl = (await relayHttpUrl()).replace(/\/+$/, "");
    const url = `${baseUrl}${WELCOME_TEAM_PATH}`;
    const body = JSON.stringify(input);
    const tags = [
      ["u", url],
      ["method", "PUT"],
      ["nonce", nonceFactory()],
      ["payload", await sha256Hex(body)],
    ];
    const event = await signEvent({
      kind: NIP98_KIND,
      content: "",
      tags,
    });
    const response = await fetchImplementation(url, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        Authorization: `Nostr ${base64Utf8(JSON.stringify(event))}`,
        "Content-Type": "application/json",
      },
      body,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(await errorMessage(response, payload));
    }
    return parseRegisteredWelcomeTeam(payload);
  };
}

export const registerWelcomeTeam = createWelcomeTeamRegistrar();
