import type { Event } from "nostr-tools/pure";
import { v2 as nip44 } from "nostr-tools/nip44";
import { sign, type ChatIdentity } from "./identity.ts";
import { tag, threadReference } from "./model.ts";

/** NIP-RS coordinates use exactly 32 lowercase hex digits, not UUID syntax. */
export function newReadStateId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(16)), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

/** Read Buzz NIP-RS snapshots, encrypted to the same identity on all devices. */
export function readSnapshot(
  event: Event,
  identity: ChatIdentity,
): { clientId: string; contexts: Record<string, number> } | null {
  if (
    event.kind !== 30078 ||
    event.pubkey !== identity.pubkey ||
    !/^read-state:[a-f0-9]{32}$/.test(tag(event, "d") ?? "") ||
    event.tags.filter((item) => item[0] === "d").length !== 1 ||
    event.tags.filter((item) => item[0] === "t" && item[1] === "read-state")
      .length !== 1
  )
    return null;
  try {
    const key = nip44.utils.getConversationKey(
      identity.secret,
      identity.pubkey,
    );
    const blob = JSON.parse(nip44.decrypt(event.content, key));
    if (
      blob.v !== 1 ||
      typeof blob.client_id !== "string" ||
      blob.client_id.length < 1 ||
      blob.client_id.length > 64 ||
      !blob.contexts ||
      typeof blob.contexts !== "object" ||
      Array.isArray(blob.contexts) ||
      Object.keys(blob.contexts).length > 10_000
    )
      return null;
    const contexts = Object.fromEntries(
      Object.entries(blob.contexts).filter(
        ([name, value]) =>
          new TextEncoder().encode(name).length <= 256 &&
          !name.startsWith("ov_") &&
          typeof value === "number" &&
          Number.isSafeInteger(value) &&
          value >= 0 &&
          value <= 4294967295,
      ),
    ) as Record<string, number>;
    return { clientId: blob.client_id, contexts };
  } catch {
    return null;
  }
}

export function readContexts(event: Event, identity: ChatIdentity) {
  return readSnapshot(event, identity)?.contexts ?? {};
}

/** Fold legacy channel/thread frontiers without marking a collapsed reply read. */
export function effectiveReadAt(event: Event, reads: Record<string, number>) {
  const root = threadReference(event.tags).root;
  return Math.max(
    reads[`msg:${event.id}`] ?? 0,
    reads[tag(event, "h") ?? ""] ?? 0,
    root ? (reads[`thread:${root}`] ?? 0) : 0,
  );
}

export function makeReadState(
  identity: ChatIdentity,
  slot: string,
  clientId: string,
  contexts: Record<string, number>,
  timestamp: number,
) {
  if (!/^[a-f0-9]{32}$/.test(slot) || !clientId || clientId.length > 64)
    throw new Error("Неверный идентификатор синхронизации прочтения.");
  const plaintext = JSON.stringify({ v: 1, client_id: clientId, contexts });
  if (new TextEncoder().encode(plaintext).length > 32768)
    throw new Error("Слишком много отметок прочтения для одной синхронизации.");
  return sign(identity, {
    kind: 30078,
    created_at: timestamp,
    tags: [
      ["d", `read-state:${slot}`],
      ["t", "read-state"],
    ],
    content: nip44.encrypt(
      plaintext,
      nip44.utils.getConversationKey(identity.secret, identity.pubkey),
    ),
  });
}
