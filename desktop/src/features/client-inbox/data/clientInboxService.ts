import { z } from "zod";
import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";

export const clientSchema = z.object({
  id: z.string().uuid(),
  channelId: z.string().uuid(),
  rootEventId: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  threaded: z.boolean(),
  title: z.string(),
  parentName: z.string().nullable().optional(),
  connectorPubkey: z.string().nullable().optional(),
  hermesPubkey: z.string().nullable().optional(),
  hermesInChannel: z.boolean().optional(),
  branchId: z.string().uuid().nullable(),
  branchName: z.string().nullable(),
  assignee: z.string().nullable(),
  status: z.enum(["waiting_staff", "waiting_parent", "resolved"]),
  version: z.number().int().positive(),
  familyId: z.string().uuid().nullable(),
  representativeId: z.string().uuid().nullable(),
  owner: z.enum(["hermes", "human"]),
  provider: z.string(),
  connectionId: z.string().uuid(),
  connectionName: z.string(),
  connectionStatus: z.string(),
  updatedAt: z.string(),
  lastInboundAt: z.string().nullable(),
  legacyChannelId: z.string().uuid().nullable(),
});
export const inboxSchema = z.object({
  systemPubkey: z.string().optional(),
  communityId: z.string().uuid(),
  viewerPubkey: z.string(),
  canManageRouting: z.boolean(),
  connections: z.array(z.object({ id: z.string().uuid(), name: z.string() })),
  items: z.array(clientSchema),
  nextCursor: z
    .object({ before: z.string(), afterId: z.string().uuid() })
    .nullable(),
  branches: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      channelId: z.string().uuid().nullable(),
      version: z.number(),
      responsiblePubkeys: z.array(z.string()),
    }),
  ),
  staff: z.array(
    z.object({
      pubkey: z.string(),
      name: z.string(),
      channelId: z.string().uuid(),
    }),
  ),
});
export type ClientConversation = z.infer<typeof clientSchema>;
export type ClientInbox = z.infer<typeof inboxSchema>;
export type ClientAction =
  | { type: "assign_branch"; branchId: string }
  | { type: "assign"; pubkey: string }
  | { type: "set_status"; status: ClientConversation["status"] }
  | { type: "migrate_legacy"; expectedRouteVersion: number };
type Options = {
  relayHttpUrl?: typeof getRelayHttpUrl;
  signEvent?: typeof signRelayEvent;
  fetch?: typeof fetch;
};

/** Mounted-workspace client: pins origin, signs commands, never fabricates client data. */
export class ClientInboxService {
  private origin: string | null = null;
  private options: Options;
  constructor(options: Options = {}) {
    this.options = options;
  }
  private async request(path: string, body?: string) {
    this.origin ??= (
      await (this.options.relayHttpUrl ?? getRelayHttpUrl)()
    ).replace(/\/$/, "");
    const url = this.origin + path;
    const method = body === undefined ? "GET" : "POST";
    const tags = [
      ["u", url],
      ["method", method],
      ["nonce", crypto.randomUUID()],
    ];
    if (body !== undefined) {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(body),
      );
      tags.push([
        "payload",
        Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      ]);
    }
    const auth = await (this.options.signEvent ?? signRelayEvent)({
      kind: 27235,
      content: "",
      tags,
    });
    let encoded = "";
    for (const byte of new TextEncoder().encode(JSON.stringify(auth)))
      encoded += String.fromCharCode(byte);
    const response = await (this.options.fetch ?? fetch)(url, {
      method,
      body,
      headers: {
        Authorization: `Nostr ${btoa(encoded)}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
      redirect: "error",
    });
    const result: unknown = await response.json();
    if (!response.ok)
      throw new Error(
        z.object({ error: z.string().optional() }).parse(result).error ??
          `HTTP ${response.status}`,
      );
    return result;
  }
  async load(filters: Record<string, string> = {}) {
    const query = new URLSearchParams(
      Object.entries(filters).filter(([, value]) => value !== ""),
    );
    return inboxSchema.parse(
      await this.request(
        `/api/airhop/staff/v1/client-conversations${query.size ? `?${query}` : ""}`,
      ),
    );
  }
  async loadRoutingConfiguration() {
    return this.load({ configurationOnly: "true" });
  }
  async command(
    communityId: string,
    conversation: Pick<ClientConversation, "id" | "version">,
    action: ClientAction,
    idempotencyKey = crypto.randomUUID(),
  ) {
    return this.sendCommand(communityId, {
      idempotencyKey,
      conversationId: conversation.id,
      expectedVersion: conversation.version,
      action,
    });
  }
  async setResponsibles(
    communityId: string,
    branch: ClientInbox["branches"][number],
    responsiblePubkeys: string[],
  ) {
    return this.sendCommand(communityId, {
      idempotencyKey: crypto.randomUUID(),
      branchId: branch.id,
      expectedVersion: branch.version,
      responsiblePubkeys,
    });
  }
  private async sendCommand(communityId: string, command: unknown) {
    const event = await (this.options.signEvent ?? signRelayEvent)({
      kind: 9051,
      content: JSON.stringify(command),
      tags: [
        ["airhop-community", communityId],
        ["-"],
        ["nonce", crypto.randomUUID()],
      ],
    });
    const body = JSON.stringify(event);
    const send = async () =>
      z
        .object({ accepted: z.boolean(), message: z.string() })
        .parse(await this.request("/events", body));
    let result: Awaited<ReturnType<typeof send>>;
    try {
      result = await send();
    } catch (e) {
      if (
        !(
          e instanceof TypeError ||
          (e instanceof DOMException &&
            ["TimeoutError", "AbortError"].includes(e.name))
        )
      )
        throw e;
      result = await send(); // Retry this exact signed command, never a fresh mutation.
    }
    if (!result.accepted) throw new Error(result.message);
    return result;
  }
  async migrationPreview(id: string) {
    return z
      .object({
        conversationId: z.string().uuid(),
        version: z.number(),
        threaded: z.boolean(),
        oldChannelId: z.string().uuid(),
        targetChannelId: z.string().uuid().nullable(),
        routeVersion: z.number(),
        pendingDeliveries: z.number(),
        unpublishedReplies: z.number(),
        liveTurns: z.number(),
      })
      .parse(
        await this.request(
          `/api/airhop/staff/v1/client-conversations/${id}/migration-preview`,
        ),
      );
  }
}
