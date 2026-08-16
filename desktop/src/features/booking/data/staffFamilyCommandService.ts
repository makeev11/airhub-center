import { z } from "zod";

import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;

const uuidSchema = z.string().uuid();
const contactChannelSchema = z.enum([
  "telegram",
  "max",
  "whatsapp",
  "phone",
  "none",
]);

const representativeUpdateOutcomeSchema = z.object({
  representativeId: uuidSchema,
  version: z.number().int().positive(),
  hasPendingDuplicate: z.boolean(),
  replayed: z.boolean(),
});

export type StaffRepresentativeContactChannel = z.infer<
  typeof contactChannelSchema
>;
export type StaffRepresentativeUpdateOutcome = z.infer<
  typeof representativeUpdateOutcomeSchema
>;

export type UpdateStaffFamilyRepresentativeInput = {
  familyId: string;
  representativeId: string;
  expectedVersion: number;
  displayName: string;
  phone: string;
  preferredContactChannel: StaffRepresentativeContactChannel;
  idempotencyKey?: string;
};

export interface StaffFamilyCommandService {
  updateRepresentative(
    input: UpdateStaffFamilyRepresentativeInput,
  ): Promise<StaffRepresentativeUpdateOutcome>;
}

type EventSigner = (input: {
  kind: number;
  content: string;
  tags: string[][];
}) => Promise<RelayEvent>;

type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

type HttpStaffFamilyCommandServiceOptions = {
  relayHttpUrl?: () => Promise<string>;
  signEvent?: EventSigner;
  fetch?: FetchImplementation;
  idempotencyKeyFactory?: () => string;
};

export class StaffFamilyCommandApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StaffFamilyCommandApiError";
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

async function nip98PutAuthorization(
  url: string,
  body: string,
  nonce: string,
  signEvent: EventSigner,
): Promise<string> {
  const event = await signEvent({
    kind: NIP98_KIND,
    content: "",
    tags: [
      ["u", url],
      ["method", "PUT"],
      ["payload", await sha256Hex(body)],
      ["nonce", nonce],
    ],
  });
  return `Nostr ${base64Utf8(JSON.stringify(event))}`;
}

/** NIP-98 client for idempotent, audited family staff commands. */
export class HttpStaffFamilyCommandService
  implements StaffFamilyCommandService
{
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;
  private readonly idempotencyKeyFactory: () => string;

  constructor(options: HttpStaffFamilyCommandServiceOptions = {}) {
    this.relayHttpUrl = options.relayHttpUrl ?? getRelayHttpUrl;
    this.signEvent = options.signEvent ?? signRelayEvent;
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
    this.idempotencyKeyFactory =
      options.idempotencyKeyFactory ?? (() => crypto.randomUUID());
  }

  async updateRepresentative(
    input: UpdateStaffFamilyRepresentativeInput,
  ): Promise<StaffRepresentativeUpdateOutcome> {
    const familyId = uuidSchema.safeParse(input.familyId);
    const representativeId = uuidSchema.safeParse(input.representativeId);
    const channel = contactChannelSchema.safeParse(
      input.preferredContactChannel,
    );
    if (
      !familyId.success ||
      !representativeId.success ||
      !channel.success ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 1 ||
      !input.displayName.trim() ||
      input.displayName.trim().length > 160 ||
      !input.phone.trim() ||
      input.phone.trim().length > 80
    ) {
      throw new StaffFamilyCommandApiError(
        400,
        "Invalid AirHub representative update.",
      );
    }
    const baseUrl = (await this.relayHttpUrl()).replace(/\/+$/, "");
    const url = `${baseUrl}/api/airhop/staff/v1/families/${encodeURIComponent(familyId.data)}/representatives/${encodeURIComponent(representativeId.data)}`;
    const body = JSON.stringify({
      expectedVersion: input.expectedVersion,
      displayName: input.displayName.trim(),
      phone: input.phone.trim(),
      preferredContactChannel: channel.data,
    });
    const authorization = await nip98PutAuthorization(
      url,
      body,
      crypto.randomUUID(),
      this.signEvent,
    );
    const response = await this.fetchImplementation(url, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey ?? this.idempotencyKeyFactory(),
      },
      body,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const message =
        typeof payload === "object" &&
        payload !== null &&
        "error" in payload &&
        typeof payload.error === "string"
          ? payload.error
          : `HTTP ${response.status}`;
      throw new StaffFamilyCommandApiError(response.status, message);
    }
    const parsed = representativeUpdateOutcomeSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffFamilyCommandApiError(
        502,
        "The AirHub family command API returned invalid data.",
      );
    }
    return parsed.data;
  }
}

export function createHttpStaffFamilyCommandService(): StaffFamilyCommandService {
  return new HttpStaffFamilyCommandService();
}
