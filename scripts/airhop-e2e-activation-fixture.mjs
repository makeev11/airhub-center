import { createHash, createHmac } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const KEY_DERIVATION_LABEL = Buffer.from("buzz-invite-v1");
const ACTIVATION_KEY_LABEL = Buffer.from("airhop-center-activation-key-v1");
const ACTIVATION_DIGEST_DOMAIN = Buffer.from(
  "airhop.center.activation-code-digest.v1",
);

export const AIRHOP_E2E_ACTIVATION_CODE = `ahc_1_${Buffer.alloc(32, 0x42).toString("base64url")}`;

function sha256(...parts) {
  const hash = createHash("sha256");
  for (const part of parts) hash.update(part);
  return hash.digest();
}

function lengthPrefixed(part) {
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(part.length));
  return Buffer.concat([length, part]);
}

function uuidBytes(uuid) {
  const compact = uuid.replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(compact)) {
    throw new Error(`invalid community UUID: ${uuid}`);
  }
  return Buffer.from(compact, "hex");
}

export function activationCodeDigestHex(
  relaySecretHex,
  communityId,
  activationCode,
) {
  if (!/^[0-9a-f]{64}$/i.test(relaySecretHex)) {
    throw new Error("relay secret must be 32-byte hex");
  }
  if (!/^ahc_1_[A-Za-z0-9_-]{43}$/.test(activationCode)) {
    throw new Error("activation code must use the canonical ahc_1_ format");
  }
  const inviteKey = sha256(
    Buffer.from(relaySecretHex, "hex"),
    KEY_DERIVATION_LABEL,
  );
  const activationKey = sha256(inviteKey, ACTIVATION_KEY_LABEL);
  const mac = createHmac("sha256", activationKey);
  for (const component of [
    ACTIVATION_DIGEST_DOMAIN,
    uuidBytes(communityId),
    Buffer.from(activationCode),
  ]) {
    mac.update(lengthPrefixed(component));
  }
  return mac.digest("hex");
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const command = process.argv[2];
  if (command === "code") {
    process.stdout.write(AIRHOP_E2E_ACTIVATION_CODE);
  } else if (command === "digest") {
    process.stdout.write(
      activationCodeDigestHex(
        process.argv[3] ?? "",
        process.argv[4] ?? "",
        process.argv[5] ?? "",
      ),
    );
  } else {
    throw new Error(
      "usage: airhop-e2e-activation-fixture.mjs code|digest <relay-secret> <community-id> <activation-code>",
    );
  }
}
