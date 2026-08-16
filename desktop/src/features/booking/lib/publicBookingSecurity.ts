const BASE64URL_ALPHABET =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

function encodeBase64Url(bytes: Uint8Array): string {
  let result = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const first = bytes[index] ?? 0;
    const second = bytes[index + 1] ?? 0;
    const third = bytes[index + 2] ?? 0;
    const block = (first << 16) | (second << 8) | third;
    result += BASE64URL_ALPHABET[(block >> 18) & 63];
    result += BASE64URL_ALPHABET[(block >> 12) & 63];
    if (index + 1 < bytes.length) {
      result += BASE64URL_ALPHABET[(block >> 6) & 63];
    }
    if (index + 2 < bytes.length) result += BASE64URL_ALPHABET[block & 63];
  }
  return result;
}

function toHex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

function requireCrypto(): Crypto {
  if (!globalThis.crypto?.subtle) {
    throw new Error("Secure Web Crypto is unavailable");
  }
  return globalThis.crypto;
}

/** Generates a URL-safe opaque credential with 256 bits of entropy. */
export function generatePublicBookingToken(): string {
  const bytes = new Uint8Array(32);
  requireCrypto().getRandomValues(bytes);
  return encodeBase64Url(bytes);
}

/** Produces the one-way SHA-256 digest persisted by the booking model. */
export async function digestPublicBookingCredential(
  value: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  return toHex(await requireCrypto().subtle.digest("SHA-256", bytes));
}
