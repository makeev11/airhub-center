import type { AirhopActionContext } from "@/features/booking/actions/airhopActionSchemas";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";

export function sha256Hex(value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}

export function createStaffActionContext(
  now: string,
  idFactory: () => string,
): AirhopActionContext {
  return {
    now,
    idempotencyKey: `staff-ui:${idFactory()}`,
    idFactory,
    digest: sha256Hex,
  };
}
