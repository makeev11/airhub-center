import { z } from "zod";

import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;

const decisionOutcomeSchema = z.object({
  bookingId: z.string().uuid(),
  status: z.enum(["confirmed", "rejected"]),
  notification: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("messenger"),
      channel: z.enum(["telegram", "max", "whatsapp"]),
      state: z.literal("queued"),
    }),
    z.object({
      kind: z.literal("staff_call"),
      state: z.literal("queued"),
    }),
  ]),
  replayed: z.boolean(),
});

export type StaffBookingDecision = "confirm" | "reject";
export type StaffBookingDecisionOutcome = z.infer<
  typeof decisionOutcomeSchema
>;

export interface StaffBookingDecisionService {
  decideBooking(input: {
    bookingId: string;
    decision: StaffBookingDecision;
    idempotencyKey?: string;
  }): Promise<StaffBookingDecisionOutcome>;
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

type HttpStaffBookingDecisionServiceOptions = {
  relayHttpUrl?: () => Promise<string>;
  signEvent?: EventSigner;
  fetch?: FetchImplementation;
  idempotencyKeyFactory?: () => string;
};

export class StaffBookingDecisionApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StaffBookingDecisionApiError";
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

async function nip98PostAuthorization(
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
      ["method", "POST"],
      ["payload", await sha256Hex(body)],
      ["nonce", nonce],
    ],
  });
  return `Nostr ${base64Utf8(JSON.stringify(event))}`;
}

/** NIP-98 client for the authoritative staff booking-decision command. */
export class HttpStaffBookingDecisionService
  implements StaffBookingDecisionService
{
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;
  private readonly idempotencyKeyFactory: () => string;

  constructor(options: HttpStaffBookingDecisionServiceOptions = {}) {
    this.relayHttpUrl = options.relayHttpUrl ?? getRelayHttpUrl;
    this.signEvent = options.signEvent ?? signRelayEvent;
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
    this.idempotencyKeyFactory =
      options.idempotencyKeyFactory ?? (() => crypto.randomUUID());
  }

  async decideBooking(input: {
    bookingId: string;
    decision: StaffBookingDecision;
    idempotencyKey?: string;
  }): Promise<StaffBookingDecisionOutcome> {
    const baseUrl = (await this.relayHttpUrl()).replace(/\/+$/, "");
    const url = `${baseUrl}/api/airhop/staff/v1/bookings/${encodeURIComponent(input.bookingId)}/decision`;
    const body = JSON.stringify({ decision: input.decision });
    const idempotencyKey =
      input.idempotencyKey ?? this.idempotencyKeyFactory();
    const authorization = await nip98PostAuthorization(
      url,
      body,
      crypto.randomUUID(),
      this.signEvent,
    );
    const response = await this.fetchImplementation(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
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
      throw new StaffBookingDecisionApiError(response.status, message);
    }
    const parsed = decisionOutcomeSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffBookingDecisionApiError(
        502,
        "The AirHub decision API returned invalid data.",
      );
    }
    return parsed.data;
  }
}

export function createHttpStaffBookingDecisionService(): StaffBookingDecisionService {
  return new HttpStaffBookingDecisionService();
}
