import {
  getPublicKey,
  type EventTemplate,
  finalizeEvent,
} from "nostr-tools/pure";
import { decode } from "nostr-tools/nip19";

export type ChatIdentity = {
  secret: Uint8Array;
  pubkey: string;
  origin: string;
  /** Session-only trusted app routing; never imported from pairing or saved in a vault. */
  httpBase?: string;
};
export type Vault = {
  v: 1;
  origin: string;
  pubkey: string;
  salt: string;
  iv: string;
  ciphertext: string;
};
export const VAULT_KEY = "airhop.chat.identity.v1";
const ITERATIONS = 600_000;
const encoder = new TextEncoder();

export function encode64(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}

function decode64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

/** Resolve a transport URL without allowing credentials, query strings or insecure remote hosts. */
export function relayOrigin(value: string): string {
  const url = new URL(value);
  if (url.protocol === "wss:") url.protocol = "https:";
  if (url.protocol === "ws:") url.protocol = "http:";
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error("Нужен защищённый адрес вашего Центра.");
  }
  return url.origin;
}

export function wsOrigin(origin: string): string {
  return relayOrigin(origin).replace(/^http/, "ws");
}

/** Imported credentials are pinned to this Center, never to an arbitrary URL from a QR code. */
export function importIdentity(
  payload: string,
  expectedOrigin: string,
): ChatIdentity {
  const data = JSON.parse(payload);
  const origin = relayOrigin(data.relayUrl);
  if (origin !== relayOrigin(expectedOrigin))
    throw new Error(
      "Этот код относится к другому Центру. Откройте чат нужного Центра.",
    );
  if (typeof data.nsec !== "string")
    throw new Error("В коде нет ключа подключения.");
  const nsec: string = data.nsec;
  const key = decode(nsec);
  if (key.type !== "nsec") throw new Error("В коде нет ключа подключения.");
  const secret = Uint8Array.from(key.data);
  const pubkey = getPublicKey(secret);
  if (data.pubkey !== pubkey)
    throw new Error("Ключ и учётная запись не совпадают.");
  return { secret, pubkey, origin };
}

export function sign(
  identity: ChatIdentity,
  event: Omit<EventTemplate, "created_at"> & { created_at?: number },
) {
  return finalizeEvent(
    { ...event, created_at: event.created_at ?? Math.floor(Date.now() / 1000) },
    identity.secret,
  );
}

async function deriveKey(password: string, salt: Uint8Array<ArrayBuffer>) {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: ITERATIONS },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/** Encrypt at rest; the password and decrypted key are never written to browser storage. */
export async function sealIdentity(
  identity: ChatIdentity,
  password: string,
): Promise<Vault> {
  if (password.length < 12)
    throw new Error("Придумайте пароль не короче 12 символов.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ciphertext = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(`${identity.origin}|${identity.pubkey}`),
    },
    key,
    Uint8Array.from(identity.secret),
  );
  return {
    v: 1,
    origin: identity.origin,
    pubkey: identity.pubkey,
    salt: encode64(salt),
    iv: encode64(iv),
    ciphertext: encode64(new Uint8Array(ciphertext)),
  };
}

export async function openIdentity(
  raw: string,
  password: string,
  expectedOrigin: string,
): Promise<ChatIdentity> {
  try {
    if (raw.length > 4096) throw new Error("vault too large");
    const data: Vault = JSON.parse(raw);
    if (
      data.v !== 1 ||
      data.origin !== relayOrigin(expectedOrigin) ||
      !/^[a-f0-9]{64}$/.test(data.pubkey)
    )
      throw new Error("invalid vault");
    const salt = decode64(data.salt);
    const iv = decode64(data.iv);
    const ciphertext = decode64(data.ciphertext);
    if (salt.length !== 16 || iv.length !== 12 || ciphertext.length !== 48)
      throw new Error("invalid ciphertext");
    const key = await deriveKey(password, salt);
    const secret = new Uint8Array(
      await crypto.subtle.decrypt(
        {
          name: "AES-GCM",
          iv,
          additionalData: encoder.encode(`${data.origin}|${data.pubkey}`),
        },
        key,
        ciphertext,
      ),
    );
    if (getPublicKey(secret) !== data.pubkey) throw new Error("wrong identity");
    return { secret, pubkey: data.pubkey, origin: data.origin };
  } catch {
    throw new Error(
      "Не удалось открыть чат. Проверьте пароль или подключите устройство заново.",
    );
  }
}
