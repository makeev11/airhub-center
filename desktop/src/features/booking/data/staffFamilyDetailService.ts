import { z } from "zod";

import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;

const uuidSchema = z.string().uuid();
const dateSchema = z.string().date();
const dateTimeSchema = z.string().datetime({ offset: true });
const timeSchema = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d+)?)?$/);
const entityStatusSchema = z.enum(["active", "archived"]);
const bookingStatusSchema = z.enum([
  "pending_confirmation",
  "confirmed",
  "rejected",
  "cancelled_by_parent",
  "cancelled_by_center",
]);
const contactChannelSchema = z.enum([
  "telegram",
  "max",
  "whatsapp",
  "phone",
  "none",
]);
const messengerChannelSchema = z.enum(["telegram", "max", "whatsapp"]);
const weekdaySchema = z.enum([
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
]);
const transferRequestSchema = z.object({
  status: z.literal("pending"),
  requestedAt: dateTimeSchema,
  comment: z.string().max(1_000).optional(),
});

export const staffFamilyDetailSchema = z.object({
  organization: z.object({
    id: uuidSchema,
    name: z.string().min(1).max(160),
    locale: z.string().min(2).max(32),
    timeZone: z.string().min(1).max(80),
    currentDate: dateSchema,
  }),
  family: z.object({
    id: uuidSchema,
    displayName: z.string().min(1).max(200),
    primaryRepresentativeId: uuidSchema,
    status: entityStatusSchema,
    version: z.number().int().positive(),
    createdAt: dateTimeSchema,
    updatedAt: dateTimeSchema,
  }),
  representatives: z.array(
    z.object({
      id: uuidSchema,
      displayName: z.string().min(1).max(160),
      phoneNormalized: z.string().regex(/^\+[1-9]\d{9,14}$/),
      phoneDisplay: z.string().min(1).max(80),
      preferredContactChannel: contactChannelSchema,
      verifiedMessengerChannels: z.array(messengerChannelSchema),
      status: entityStatusSchema,
      version: z.number().int().positive(),
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
    }),
  ),
  children: z.array(
    z.object({
      id: uuidSchema,
      displayName: z.string().min(1).max(160),
      birthDate: dateSchema,
      note: z.string().max(4_000).nullable(),
      status: entityStatusSchema,
      version: z.number().int().positive(),
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
    }),
  ),
  enrollments: z.array(
    z.object({
      id: uuidSchema,
      childId: uuidSchema,
      groupId: uuidSchema,
      groupName: z.string().min(1).max(200),
      tariff: z
        .object({
          id: uuidSchema,
          name: z.string().min(1).max(160),
          priceMinor: z.number().int().nonnegative(),
          currency: z.string().regex(/^[A-Z]{3}$/),
        })
        .nullable(),
      startDate: dateSchema,
      endDate: dateSchema.nullable(),
      status: z.enum(["active", "paused", "ended"]),
      assignmentState: z.enum(["needs_assignment", "configured"]),
      schedule: z.array(
        z.object({
          recurrenceRuleId: uuidSchema,
          weekday: weekdaySchema,
          startTime: timeSchema,
          endTime: timeSchema,
        }),
      ),
      version: z.number().int().positive(),
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
    }),
  ),
  bookings: z.array(
    z.object({
      id: uuidSchema,
      representativeId: uuidSchema,
      childId: uuidSchema,
      status: bookingStatusSchema,
      visitKind: z.enum(["trial", "single"]),
      transferRequest: transferRequestSchema.nullable(),
      recurrenceRuleId: uuidSchema,
      originalDate: dateSchema,
      occurrenceId: uuidSchema,
      date: dateSchema,
      startTime: timeSchema,
      endTime: timeSchema,
      occurrenceStatus: z.enum(["scheduled", "moved", "modified", "cancelled"]),
      groupId: uuidSchema,
      groupName: z.string().min(1).max(200),
      branchId: uuidSchema,
      branchName: z.string().min(1).max(160),
      version: z.number().int().positive(),
      createdAt: dateTimeSchema,
      updatedAt: dateTimeSchema,
    }),
  ),
  bookingHistoryTruncated: z.boolean(),
  hasPendingDuplicate: z.boolean(),
});

export type StaffFamilyDetail = z.infer<typeof staffFamilyDetailSchema>;

export interface StaffFamilyDetailService {
  getFamilyDetail(familyId: string): Promise<StaffFamilyDetail>;
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

type HttpStaffFamilyDetailServiceOptions = {
  relayHttpUrl?: () => Promise<string>;
  signEvent?: EventSigner;
  fetch?: FetchImplementation;
};

export class StaffFamilyDetailApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StaffFamilyDetailApiError";
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

/** NIP-98 client for an authoritative, staff-only AirHub family card. */
export class HttpStaffFamilyDetailService implements StaffFamilyDetailService {
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;

  constructor(options: HttpStaffFamilyDetailServiceOptions = {}) {
    this.relayHttpUrl = options.relayHttpUrl ?? getRelayHttpUrl;
    this.signEvent = options.signEvent ?? signRelayEvent;
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async getFamilyDetail(familyId: string): Promise<StaffFamilyDetail> {
    const parsedFamilyId = uuidSchema.safeParse(familyId);
    if (!parsedFamilyId.success) {
      throw new StaffFamilyDetailApiError(400, "Invalid AirHub family id.");
    }
    const baseUrl = (await this.relayHttpUrl()).replace(/\/+$/, "");
    const url = `${baseUrl}/api/airhop/staff/v1/families/${encodeURIComponent(parsedFamilyId.data)}`;
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
      throw new StaffFamilyDetailApiError(response.status, message);
    }
    const parsed = staffFamilyDetailSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffFamilyDetailApiError(
        502,
        "The AirHub family API returned invalid data.",
      );
    }
    return parsed.data;
  }
}

export function createHttpStaffFamilyDetailService(): StaffFamilyDetailService {
  return new HttpStaffFamilyDetailService();
}
