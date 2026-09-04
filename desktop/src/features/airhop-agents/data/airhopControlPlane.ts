import { z } from "zod";

import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;
const CONNECTIONS_PATH = "/api/airhop/integrations/v1/channel-connections";
const DEPLOYMENTS_PATH = "/api/airhop/agents/v1/deployments";

const channelConnectionSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  provider: z.enum(["telegram", "whatsapp_cloud"]),
  displayName: z.string().min(1).max(160),
  connectorPubkey: z.string().regex(/^[0-9a-f]{64}$/),
  status: z.enum(["active", "paused", "disabled"]),
  hermesEnabled: z.boolean(),
  capabilities: z.record(z.string(), z.unknown()),
  observedStatus: z.enum(["offline", "connecting", "ready", "degraded"]),
  observedCapabilities: z.record(z.string(), z.unknown()),
  lastHeartbeatAt: z.string().datetime({ offset: true }).nullable(),
  lastErrorCode: z.string().max(120).nullable(),
  version: z.number().int().positive(),
});

const connectionsResponseSchema = z.object({
  schemaVersion: z.literal("airhop.channel-connections.v1"),
  connections: z.array(channelConnectionSchema),
  provisioning: z
    .object({
      telegram: z.object({ available: z.boolean() }),
    })
    .default({ telegram: { available: false } }),
});

const connectionResponseSchema = z.object({
  schemaVersion: z.literal("airhop.channel-connection.v1"),
  connection: channelConnectionSchema,
});

const telegramConnectionResponseSchema = z.object({
  schemaVersion: z.literal("airhop.telegram-connection.v1"),
  connection: channelConnectionSchema,
  bot: z.object({
    id: z.string().min(1),
    firstName: z.string().min(1),
    username: z.string().min(1).nullable(),
  }),
});

const hermesDeploymentSchema = z.object({
  schemaVersion: z.literal("airhop.agent.deployment.v1"),
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  blueprintKey: z.literal("airhop.hermes.parent_administrator"),
  blueprintVersion: z.number().int().positive(),
  role: z.literal("parent_administrator"),
  agentPubkey: z.string().regex(/^[0-9a-f]{64}$/),
  profileRef: z.string().min(1).max(300),
  runtimeRevision: z.string().min(1).max(160),
  personaRevision: z.string().min(1).max(160),
  skillsRevision: z.string().min(1).max(160),
  modelRevision: z.string().min(1).max(160),
  enabled: z.boolean(),
  paused: z.boolean(),
  manageBookings: z.boolean(),
  version: z.number().int().positive(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});

const currentDeploymentResponseSchema = z.object({
  schemaVersion: z.literal("airhop.agent.deployments.v1"),
  deployment: hermesDeploymentSchema.nullable(),
});

export type AirhopChannelConnection = z.infer<typeof channelConnectionSchema>;
export type AirhopConnectionsOverview = z.infer<
  typeof connectionsResponseSchema
>;
export type AirhopTelegramConnection = z.infer<
  typeof telegramConnectionResponseSchema
>;
export type AirhopHermesDeployment = z.infer<typeof hermesDeploymentSchema>;

export type PutAirhopChannelConnection = Readonly<{
  id: string;
  provider: AirhopChannelConnection["provider"];
  displayName: string;
  connectorPubkey: string;
  status: AirhopChannelConnection["status"];
  hermesEnabled: boolean;
  capabilities: Record<string, unknown>;
  expectedVersion: number;
}>;

type EventSigner = (input: {
  kind: number;
  content: string;
  tags: string[][];
}) => Promise<RelayEvent>;

type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

type Options = Readonly<{
  relayHttpUrl?: () => Promise<string>;
  signEvent?: EventSigner;
  fetch?: FetchImplementation;
  nonceFactory?: () => string;
}>;

export class AirhopControlPlaneError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "AirhopControlPlaneError";
    this.status = status;
  }
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

async function authorization(
  method: "GET" | "POST" | "PUT",
  url: string,
  body: string | undefined,
  nonce: string,
  signEvent: EventSigner,
): Promise<string> {
  const tags = [
    ["u", url],
    ["method", method],
    ["nonce", nonce],
  ];
  if (body !== undefined) tags.push(["payload", await sha256Hex(body)]);
  const event = await signEvent({ kind: NIP98_KIND, content: "", tags });
  return `Nostr ${base64Utf8(JSON.stringify(event))}`;
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

/** Credential-free client for the AirHop Hermes and messaging control plane. */
export class AirhopControlPlaneClient {
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;
  private readonly nonceFactory: () => string;

  constructor(options: Options = {}) {
    this.relayHttpUrl = options.relayHttpUrl ?? getRelayHttpUrl;
    this.signEvent = options.signEvent ?? signRelayEvent;
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
    this.nonceFactory = options.nonceFactory ?? (() => crypto.randomUUID());
  }

  async listConnections(): Promise<AirhopChannelConnection[]> {
    return (await this.getConnectionsOverview()).connections;
  }

  async getConnectionsOverview(): Promise<AirhopConnectionsOverview> {
    const payload = await this.request("GET", CONNECTIONS_PATH);
    return connectionsResponseSchema.parse(payload);
  }

  async connectTelegram(token: string): Promise<AirhopTelegramConnection> {
    const payload = await this.request("POST", `${CONNECTIONS_PATH}/telegram`, {
      token,
      hermesEnabled: true,
    });
    return telegramConnectionResponseSchema.parse(payload);
  }

  async putConnection(
    input: PutAirhopChannelConnection,
  ): Promise<AirhopChannelConnection> {
    const payload = await this.request(
      "PUT",
      `${CONNECTIONS_PATH}/${input.id}`,
      {
        provider: input.provider,
        displayName: input.displayName,
        connectorPubkey: input.connectorPubkey,
        status: input.status,
        hermesEnabled: input.hermesEnabled,
        capabilities: input.capabilities,
        expectedVersion: input.expectedVersion,
      },
    );
    return connectionResponseSchema.parse(payload).connection;
  }

  async getCurrentHermesDeployment(): Promise<AirhopHermesDeployment | null> {
    const payload = await this.request("GET", DEPLOYMENTS_PATH);
    return currentDeploymentResponseSchema.parse(payload).deployment;
  }

  async putHermesDeployment(
    deployment: AirhopHermesDeployment,
    patch: Partial<Pick<AirhopHermesDeployment, "enabled" | "manageBookings">>,
  ): Promise<AirhopHermesDeployment> {
    const payload = await this.request(
      "PUT",
      `${DEPLOYMENTS_PATH}/${deployment.id}`,
      {
        agentPubkey: deployment.agentPubkey,
        blueprintVersion: deployment.blueprintVersion,
        profileRef: deployment.profileRef,
        runtimeRevision: deployment.runtimeRevision,
        personaRevision: deployment.personaRevision,
        skillsRevision: deployment.skillsRevision,
        modelRevision: deployment.modelRevision,
        enabled: patch.enabled ?? deployment.enabled,
        paused: deployment.paused,
        manageBookings: patch.manageBookings ?? deployment.manageBookings,
        expectedVersion: deployment.version,
      },
    );
    return hermesDeploymentSchema.parse(payload);
  }

  private async request(
    method: "GET" | "POST" | "PUT",
    path: string,
    value?: Record<string, unknown>,
  ): Promise<unknown> {
    const relay = (await this.relayHttpUrl()).replace(/\/+$/, "");
    const url = `${relay}${path}`;
    const body = value === undefined ? undefined : JSON.stringify(value);
    const auth = await authorization(
      method,
      url,
      body,
      this.nonceFactory(),
      this.signEvent,
    );
    const response = await this.fetchImplementation(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: auth,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body }),
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new AirhopControlPlaneError(
        response.status,
        await errorMessage(response, payload),
      );
    }
    return payload;
  }
}

export function createAirhopControlPlaneClient(options: Options = {}) {
  return new AirhopControlPlaneClient(options);
}
