import { z } from "zod";

import type { WeeklyScheduleSelection } from "@/features/booking/model/bookingCore";
import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;
const ENROLLMENTS_PATH = "/api/airhop/staff/v1/enrollments";

const uuidSchema = z.string().uuid();
const weekdaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);
const commandSchema = z.object({
  familyId: uuidSchema,
  childId: uuidSchema,
  groupId: uuidSchema,
  tariffId: uuidSchema,
  startDate: z.string().date(),
  schedule: z
    .array(
      z.object({
        recurrenceRuleId: uuidSchema,
        weekday: weekdaySchema,
      }),
    )
    .min(1)
    .max(7),
});
const outcomeSchema = z.object({
  childId: uuidSchema,
  enrollmentId: uuidSchema,
  paymentExpectationId: uuidSchema,
  enrollmentVersion: z.number().int().positive(),
  paymentVersion: z.number().int().positive(),
  replayed: z.boolean(),
});

export type StaffEnrollmentOutcome = z.infer<typeof outcomeSchema>;
export type StaffEnrollmentCommand = {
  familyId: string;
  childId: string;
  groupId: string;
  tariffId: string;
  startDate: string;
  schedule: WeeklyScheduleSelection[];
  idempotencyKey?: string;
};

export interface StaffEnrollmentService {
  enroll(input: StaffEnrollmentCommand): Promise<StaffEnrollmentOutcome>;
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
type Options = {
  relayHttpUrl?: () => Promise<string>;
  signEvent?: EventSigner;
  fetch?: FetchImplementation;
  idempotencyKeyFactory?: () => string;
};

export class StaffEnrollmentApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StaffEnrollmentApiError";
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

async function authorization(
  url: string,
  body: string,
  signEvent: EventSigner,
): Promise<string> {
  const event = await signEvent({
    kind: NIP98_KIND,
    content: "",
    tags: [
      ["u", url],
      ["method", "POST"],
      ["payload", await sha256Hex(body)],
      ["nonce", crypto.randomUUID()],
    ],
  });
  return `Nostr ${base64Utf8(JSON.stringify(event))}`;
}

/** NIP-98 client for authoritative direct permanent enrollment. */
export class HttpStaffEnrollmentService implements StaffEnrollmentService {
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;
  private readonly idempotencyKeyFactory: () => string;

  constructor(options: Options = {}) {
    this.relayHttpUrl = options.relayHttpUrl ?? getRelayHttpUrl;
    this.signEvent = options.signEvent ?? signRelayEvent;
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
    this.idempotencyKeyFactory =
      options.idempotencyKeyFactory ?? (() => crypto.randomUUID());
  }

  async enroll(input: StaffEnrollmentCommand): Promise<StaffEnrollmentOutcome> {
    const parsed = commandSchema.safeParse(input);
    if (!parsed.success) {
      throw new StaffEnrollmentApiError(
        400,
        "Invalid AirHub enrollment command.",
      );
    }
    const baseUrl = (await this.relayHttpUrl()).replace(/\/+$/, "");
    const url = `${baseUrl}${ENROLLMENTS_PATH}`;
    const body = JSON.stringify(parsed.data);
    const response = await this.fetchImplementation(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: await authorization(url, body, this.signEvent),
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
      throw new StaffEnrollmentApiError(response.status, message);
    }
    const outcome = outcomeSchema.safeParse(payload);
    if (!outcome.success) {
      throw new StaffEnrollmentApiError(
        502,
        "The AirHub enrollment API returned invalid data.",
      );
    }
    return outcome.data;
  }
}

export function createHttpStaffEnrollmentService(): StaffEnrollmentService {
  return new HttpStaffEnrollmentService();
}
