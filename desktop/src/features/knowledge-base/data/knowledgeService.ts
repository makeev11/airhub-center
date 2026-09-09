import { z } from "zod";
import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import {
  artifactSchema,
  manifestSchema,
  materialSchema,
  type KnowledgeCommand,
} from "../model/knowledge";

const ROOT = "/api/airhop/knowledge/v1";
type Options = {
  relayHttpUrl?: typeof getRelayHttpUrl;
  signEvent?: typeof signRelayEvent;
  fetch?: typeof fetch;
};
function base64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

/** Per-mounted-workspace client; no cross-community singleton or fake fallback. */
export class KnowledgeService {
  private readonly options: Options;
  private base: string | null = null;
  constructor(options: Options = {}) {
    this.options = options;
  }
  private async request(
    path: string,
    body?: string | ArrayBuffer,
    headers: Record<string, string> = {},
  ) {
    // Pin the origin once. A late completion must never switch another community's data.
    this.base ??= (
      await (this.options.relayHttpUrl ?? getRelayHttpUrl)()
    ).replace(/\/$/, "");
    const url = this.base + path;
    const method = body === undefined ? "GET" : "POST";
    const tags = [
      ["u", url],
      ["method", method],
      ["nonce", crypto.randomUUID()],
    ];
    if (body !== undefined) {
      const digest = await crypto.subtle.digest(
        "SHA-256",
        typeof body === "string" ? new TextEncoder().encode(body) : body,
      );
      tags.push([
        "payload",
        Array.from(new Uint8Array(digest), (b) =>
          b.toString(16).padStart(2, "0"),
        ).join(""),
      ]);
    }
    const event = await (this.options.signEvent ?? signRelayEvent)({
      kind: 27235,
      content: "",
      tags,
    });
    const response = await (this.options.fetch ?? fetch)(url, {
      method,
      body,
      headers: {
        ...headers,
        Authorization: `Nostr ${base64(new TextEncoder().encode(JSON.stringify(event)))}`,
      },
      signal: AbortSignal.timeout(30_000),
      cache: "no-store",
      redirect: "error",
    });
    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      throw new Error(
        response.status === 403
          ? "Доступ к редактированию есть только у владельца и администратора / Owner or admin required."
          : (data.error ?? `Knowledge service: ${response.status}`),
      );
    }
    return response;
  }
  async manifest(after?: string) {
    return manifestSchema.parse(
      await (
        await this.request(
          `${ROOT}/artifacts${after ? `?after=${encodeURIComponent(after)}` : ""}`,
        )
      ).json(),
    );
  }
  async material(id: string) {
    return materialSchema.parse(
      await (
        await this.request(`${ROOT}/artifacts?id=${encodeURIComponent(id)}`)
      ).json(),
    );
  }
  async command(communityId: string, command: KnowledgeCommand) {
    const event = await (this.options.signEvent ?? signRelayEvent)({
      kind: 9050,
      content: JSON.stringify(command),
      tags: [
        ["airhop-community", communityId],
        ["-"],
        ["nonce", crypto.randomUUID()],
      ],
    });
    // Preserve this exact signed command on retry; NIP-98 auth is regenerated per attempt.
    const body = JSON.stringify(event);
    const send = async () =>
      z.object({ accepted: z.boolean(), message: z.string() }).parse(
        await (
          await this.request("/events", body, {
            "content-type": "application/json",
          })
        ).json(),
      );
    let result: { accepted: boolean; message: string };
    try {
      result = await send();
    } catch (e) {
      if (
        !(
          e instanceof TypeError ||
          (e instanceof DOMException && e.name === "TimeoutError")
        )
      )
        throw e;
      result = await send();
    }
    if (!result.accepted) throw new Error(result.message);
  }
  async upload(file: File) {
    return z.object({ id: z.uuid(), name: z.string() }).parse(
      await (
        await this.request(`${ROOT}/sources`, await file.arrayBuffer(), {
          "content-type": "application/octet-stream",
          "x-knowledge-name": encodeURIComponent(file.name),
        })
      ).json(),
    );
  }
  async original(id: string) {
    const response = await this.request(
      `${ROOT}/sources/${encodeURIComponent(id)}`,
    );
    const encoded = response.headers
      .get("content-disposition")
      ?.split("UTF-8''")[1];
    let name = "knowledge-original";
    if (encoded) {
      try {
        name = decodeURIComponent(encoded);
      } catch {
        /* Fallback remains safe. */
      }
    }
    return { name, blob: await response.blob() };
  }
  async parentPreview(query: string, branchId?: string, groupId?: string) {
    const params = new URLSearchParams({ view: "parent_preview", query });
    if (branchId) params.set("branchId", branchId);
    if (groupId) params.set("groupId", groupId);
    return z
      .object({
        documents: z.array(artifactSchema),
        isModelAnswer: z.literal(false),
      })
      .parse(await (await this.request(`${ROOT}/artifacts?${params}`)).json());
  }
}
