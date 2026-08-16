import { z } from "zod";

import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;

const bookingStatusSchema = z.enum([
  "pending_confirmation",
  "confirmed",
  "rejected",
  "cancelled_by_parent",
  "cancelled_by_center",
]);

const cursorSchema = z.object({
  priority: z.number().int().min(0).max(3),
  updatedAt: z.string().datetime({ offset: true }),
  bookingId: z.string().uuid(),
});

const transferRequestSchema = z.object({
  status: z.literal("pending"),
  requestedAt: z.string().datetime({ offset: true }),
  comment: z.string().max(1_000).optional(),
});

const queueItemSchema = z.object({
  booking: z.object({
    id: z.string().uuid(),
    status: bookingStatusSchema,
    visitKind: z.enum(["trial", "single"]),
    transferRequest: transferRequestSchema.nullable(),
    lessonRef: z.object({
      recurrenceRuleId: z.string().uuid(),
      originalDate: z.string().date(),
    }),
    version: z.number().int().positive(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  }),
  family: z.object({
    id: z.string().uuid(),
    displayName: z.string().min(1).max(200),
  }),
  representative: z.object({
    id: z.string().uuid(),
    displayName: z.string().min(1).max(160),
    phoneNormalized: z.string().regex(/^\+[1-9]\d{9,14}$/),
    phoneDisplay: z.string().min(1).max(80),
    preferredContactChannel: z.enum([
      "telegram",
      "max",
      "whatsapp",
      "phone",
      "none",
    ]),
  }),
  child: z.object({
    id: z.string().uuid(),
    displayName: z.string().min(1).max(160),
    birthDate: z.string().date(),
  }),
  occurrence: z.object({
    id: z.string().uuid(),
    date: z.string().date(),
    startTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    status: z.enum(["scheduled", "moved", "modified", "cancelled"]),
  }),
  group: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(200),
  }),
  branch: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(160),
  }),
  attentionReasons: z.array(
    z.enum(["pending_confirmation", "transfer_request", "possible_duplicate"]),
  ),
  requiresAttention: z.boolean(),
});

const queuePageSchema = z.object({
  items: z.array(queueItemSchema),
  nextCursor: cursorSchema.nullable(),
});

export type StaffBookingQueueStatus = z.infer<typeof bookingStatusSchema>;
export type StaffBookingQueueCursor = z.infer<typeof cursorSchema>;
export type StaffBookingQueueItem = z.infer<typeof queueItemSchema>;
export type StaffBookingQueuePage = z.infer<typeof queuePageSchema>;

export type StaffBookingQueueQuery = {
  status?: StaffBookingQueueStatus;
  attentionOnly?: boolean;
  limit?: number;
  cursor?: StaffBookingQueueCursor;
};

export interface StaffBookingQueueService {
  listBookingRequests(
    query?: StaffBookingQueueQuery,
  ): Promise<StaffBookingQueuePage>;
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

type HttpStaffBookingQueueServiceOptions = {
  relayHttpUrl?: () => Promise<string>;
  signEvent?: EventSigner;
  fetch?: FetchImplementation;
};

export class StaffBookingQueueApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StaffBookingQueueApiError";
    this.status = status;
  }
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function nip98GetAuthorization(
  url: string,
  nonce: string,
  signEvent: EventSigner,
): Promise<string> {
  const event = await signEvent({
    kind: NIP98_KIND,
    content: "",
    tags: [
      ["u", url],
      ["method", "GET"],
      ["nonce", nonce],
    ],
  });
  return `Nostr ${base64Utf8(JSON.stringify(event))}`;
}

function requestUrl(baseUrl: string, query: StaffBookingQueueQuery): string {
  const url = new URL(
    `${baseUrl.replace(/\/+$/, "")}/api/airhop/staff/v1/booking-requests`,
  );
  if (query.status) url.searchParams.set("status", query.status);
  if (query.attentionOnly !== undefined) {
    url.searchParams.set("attentionOnly", String(query.attentionOnly));
  }
  if (query.limit !== undefined) {
    if (
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      throw new StaffBookingQueueApiError(
        400,
        "The AirHub staff queue limit must be between 1 and 100.",
      );
    }
    url.searchParams.set("limit", String(query.limit));
  }
  if (query.cursor) {
    url.searchParams.set("cursorPriority", String(query.cursor.priority));
    url.searchParams.set("cursorUpdatedAt", query.cursor.updatedAt);
    url.searchParams.set("cursorBookingId", query.cursor.bookingId);
  }
  return url.toString();
}

/** NIP-98 client for the authoritative staff booking-request read model. */
export class HttpStaffBookingQueueService implements StaffBookingQueueService {
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;

  constructor(options: HttpStaffBookingQueueServiceOptions = {}) {
    this.relayHttpUrl = options.relayHttpUrl ?? getRelayHttpUrl;
    this.signEvent = options.signEvent ?? signRelayEvent;
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async listBookingRequests(
    query: StaffBookingQueueQuery = {},
  ): Promise<StaffBookingQueuePage> {
    const url = requestUrl(await this.relayHttpUrl(), query);
    const authorization = await nip98GetAuthorization(
      url,
      crypto.randomUUID(),
      this.signEvent,
    );
    const response = await this.fetchImplementation(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
      },
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
      throw new StaffBookingQueueApiError(response.status, message);
    }
    const parsed = queuePageSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffBookingQueueApiError(
        502,
        "The AirHub staff queue API returned invalid data.",
      );
    }
    return parsed.data;
  }
}

export function createHttpStaffBookingQueueService(): StaffBookingQueueService {
  return new HttpStaffBookingQueueService();
}
