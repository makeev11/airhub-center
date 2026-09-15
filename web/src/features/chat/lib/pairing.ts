import { secp256k1 } from "@noble/curves/secp256k1.js";
import { hkdf } from "@noble/hashes/hkdf.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import { generateSecretKey, getPublicKey, type Event } from "nostr-tools/pure";
import { v2 as nip44 } from "nostr-tools/nip44";
import {
  importIdentity,
  relayOrigin,
  sign,
  wsOrigin,
  type ChatIdentity,
} from "./identity.ts";
import { ChatRelay } from "./relay.ts";

export type PairingStep = {
  phase: "connecting" | "confirm" | "saving" | "done" | "error";
  code?: string;
  error?: string;
  confirmed?: boolean;
};
const encoder = new TextEncoder();

/** Strict NIP-AB v1 URI parsing. Keep session secrets out of URLs, logs and persistent storage. */
export function parsePairing(input: string, origin: string) {
  if (input.length > 2048 || !input.startsWith("nostrpair://"))
    throw new Error("Скопируйте код подключения из настроек Center.");
  const [pubkey, query, extra] = input.slice(12).split("?");
  if (extra || !/^[a-f0-9]{64}$/.test(pubkey))
    throw new Error("Неверный код подключения.");
  const params = new URLSearchParams(query);
  const secret = params.get("secret");
  if (
    params.getAll("secret").length !== 1 ||
    !secret ||
    !/^[a-f0-9]{64}$/.test(secret) ||
    /^0+$/.test(secret)
  )
    throw new Error("Неверный код подключения.");
  if (
    params.getAll("v").length > 1 ||
    (params.has("v") && params.get("v") !== "1")
  )
    throw new Error("Версия кода не поддерживается.");
  const relays = params.getAll("relay");
  const expected = new URL(wsOrigin(origin));
  const relay = relays.find((value) => {
    try {
      const url = new URL(value);
      return (
        url.origin === expected.origin &&
        !url.username &&
        !url.password &&
        !url.hash &&
        !url.search &&
        ["/", "/pair", "/pair/"].includes(url.pathname)
      );
    } catch {
      return false;
    }
  });
  if (!relay)
    throw new Error(
      "Код должен подключать к этому Центру. Откройте чат на адресе нужного Центра.",
    );
  return { pubkey, secret: hexToBytes(secret), relay };
}

/** Derivations match mobile pairing_crypto.dart and the desktop NIP-AB implementation. */
export function pairingKeys(
  secret: Uint8Array,
  source: string,
  targetSecret: Uint8Array,
) {
  const target = getPublicKey(targetSecret);
  const sessionId = hkdf(
    sha256,
    secret,
    new Uint8Array(),
    encoder.encode("nostr-pair-session-id"),
    32,
  );
  const shared = secp256k1
    .getSharedSecret(targetSecret, hexToBytes(`02${source}`))
    .slice(1, 33);
  const sasInput = hkdf(
    sha256,
    shared,
    secret,
    encoder.encode("nostr-pair-sas-v1"),
    32,
  );
  const code = (
    new DataView(sasInput.buffer, sasInput.byteOffset, 4).getUint32(0) %
    1_000_000
  )
    .toString()
    .padStart(6, "0");
  const transcript = new Uint8Array([
    ...sessionId,
    ...hexToBytes(source),
    ...hexToBytes(target),
    ...sasInput,
  ]);
  const transcriptHash = bytesToHex(
    hkdf(
      sha256,
      transcript,
      secret,
      encoder.encode("nostr-pair-transcript-v1"),
      32,
    ),
  );
  return {
    target,
    sessionId: bytesToHex(sessionId),
    code,
    transcriptHash,
    conversation: nip44.utils.getConversationKey(targetSecret, source),
  };
}

export class PairingSession {
  private relay: ChatRelay | null = null;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private peerConfirmed = false;
  private userConfirmed = false;
  private saving = false;
  private payload: string | null = null;
  private seen = new Set<string>();
  private ephemeral: ChatIdentity;
  private qr: ReturnType<typeof parsePairing>;
  private keys: ReturnType<typeof pairingKeys>;
  private origin: string;
  private onStep: (step: PairingStep) => void;
  private save: (identity: ChatIdentity) => Promise<void>;
  private onDone: (identity: ChatIdentity) => void;

  constructor(
    input: string,
    origin: string,
    onStep: (step: PairingStep) => void,
    save: (identity: ChatIdentity) => Promise<void>,
    onDone: (identity: ChatIdentity) => void,
  ) {
    this.origin = relayOrigin(origin);
    this.onStep = onStep;
    this.save = save;
    this.onDone = onDone;
    this.qr = parsePairing(input.trim(), origin);
    const secret = generateSecretKey();
    this.keys = pairingKeys(this.qr.secret, this.qr.pubkey, secret);
    this.ephemeral = { secret, pubkey: this.keys.target, origin: this.origin };
  }

  async start() {
    this.onStep({ phase: "connecting" });
    this.timer = setTimeout(
      () =>
        this.fail("Время подключения истекло. Создайте новый код в Center."),
      120_000,
    );
    this.relay = new ChatRelay(
      this.qr.relay,
      this.ephemeral,
      (state) => {
        if ((state === "offline" || state === "denied") && !this.stopped)
          this.fail("Подключение прервалось. Создайте новый код.");
      },
      true,
    );
    try {
      await this.relay.connect();
      if (this.stopped) return;
      this.relay.subscribe(
        [
          {
            kinds: [24134],
            authors: [this.qr.pubkey],
            "#p": [this.keys.target],
          },
        ],
        (event) => this.receive(event),
        (error) => this.fail(error.message),
      );
      this.onStep({ phase: "confirm", code: this.keys.code });
      await this.send({
        type: "offer",
        version: 1,
        session_id: this.keys.sessionId,
      });
    } catch {
      if (!this.stopped)
        this.fail(
          "Не удалось подключиться. Проверьте сеть и создайте новый код.",
        );
    }
  }

  confirm() {
    this.userConfirmed = true;
    this.onStep({ phase: "confirm", code: this.keys.code, confirmed: true });
    void this.tryImport();
  }

  private receive(event: Event) {
    if (
      this.stopped ||
      this.seen.has(event.id) ||
      Math.abs(event.created_at - Date.now() / 1000) > 150
    )
      return;
    try {
      const message = JSON.parse(
        nip44.decrypt(event.content, this.keys.conversation),
      );
      this.seen.add(event.id);
      if (message.type === "sas-confirm") {
        if (message.transcript_hash !== this.keys.transcriptHash) {
          this.fail("Проверочные коды не совпали. Подключение отменено.");
          return;
        }
        this.peerConfirmed = true;
      } else if (message.type === "payload") {
        if (
          !this.peerConfirmed ||
          message.payload_type !== "custom" ||
          typeof message.payload !== "string" ||
          message.payload.length > 4096
        )
          return;
        this.payload = message.payload;
      } else if (message.type === "abort") {
        this.fail("Подключение отменено на компьютере.");
        return;
      }
      void this.tryImport();
    } catch {
      /* Unverifiable pairing messages must not change the session. */
    }
  }

  private async tryImport() {
    if (
      this.stopped ||
      this.saving ||
      !this.peerConfirmed ||
      !this.userConfirmed ||
      !this.payload
    )
      return;
    this.saving = true;
    this.onStep({ phase: "saving" });
    let validation: ChatRelay | null = null;
    let imported: ChatIdentity | null = null;
    try {
      const identity = importIdentity(this.payload, this.origin);
      imported = identity;
      validation = new ChatRelay(wsOrigin(this.origin), identity);
      await validation.connect();
      validation.close();
      if (this.stopped) {
        identity.secret.fill(0);
        return;
      }
      await this.save(identity);
      if (this.stopped) {
        identity.secret.fill(0);
        return;
      }
      await this.send({ type: "complete", success: true }).catch(() => {});
      if (this.stopped) {
        identity.secret.fill(0);
        return;
      }
      this.close();
      this.onStep({ phase: "done" });
      this.onDone(identity);
    } catch (error) {
      imported?.secret.fill(0);
      validation?.close();
      this.fail(
        error instanceof Error
          ? error.message
          : "Не удалось сохранить подключение.",
      );
    }
  }

  private send(message: unknown): Promise<void> {
    const event = sign(this.ephemeral, {
      kind: 24134,
      tags: [["p", this.qr.pubkey]],
      content: nip44.encrypt(JSON.stringify(message), this.keys.conversation),
    });
    return (
      this.relay?.publish(event) ??
      Promise.reject(new Error("Подключение закрыто."))
    );
  }

  private fail(error: string) {
    if (this.stopped) return;
    this.close();
    this.onStep({ phase: "error", error });
  }

  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.relay?.close();
    this.relay = null;
    this.payload = null;
    this.ephemeral.secret.fill(0);
    this.qr.secret.fill(0);
    this.keys.conversation.fill(0);
  }
}
