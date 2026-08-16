import { z } from "zod";

import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;

const uuidSchema = z.string().uuid();
const statusSchema = z.enum(["active", "archived"]);
const contactChannelSchema = z.enum([
  "telegram",
  "max",
  "whatsapp",
  "phone",
  "none",
]);

const cursorSchema = z.object({
  sortName: z.string().min(1).max(200),
  familyId: uuidSchema,
});

const directoryItemSchema = z.object({
  id: uuidSchema,
  displayName: z.string().min(1).max(200),
  status: statusSchema,
  updatedAt: z.string().datetime({ offset: true }),
  primaryRepresentative: z.object({
    id: uuidSchema,
    displayName: z.string().min(1).max(160),
    phoneNormalized: z.string().regex(/^\+[1-9]\d{9,14}$/),
    phoneDisplay: z.string().min(1).max(80),
    preferredContactChannel: contactChannelSchema,
  }),
  children: z.array(
    z.object({
      id: uuidSchema,
      displayName: z.string().min(1).max(160),
      status: statusSchema,
    }),
  ),
  bookingCount: z.number().int().nonnegative(),
  activeEnrollmentCount: z.number().int().nonnegative(),
  hasPendingDuplicate: z.boolean(),
});

const directoryPageSchema = z.object({
  items: z.array(directoryItemSchema),
  nextCursor: cursorSchema.nullable(),
});

export type StaffFamilyDirectoryStatus = z.infer<typeof statusSchema>;
export type StaffFamilyDirectoryCursor = z.infer<typeof cursorSchema>;
export type StaffFamilyDirectoryItem = z.infer<typeof directoryItemSchema>;
export type StaffFamilyDirectoryPage = z.infer<typeof directoryPageSchema>;

export type StaffFamilyDirectoryQuery = {
  status?: StaffFamilyDirectoryStatus;
  search?: string;
  limit?: number;
  cursor?: StaffFamilyDirectoryCursor;
};

export interface StaffFamilyDirectoryService {
  listFamilies(
    query?: StaffFamilyDirectoryQuery,
  ): Promise<StaffFamilyDirectoryPage>;
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

type HttpStaffFamilyDirectoryServiceOptions = {
  relayHttpUrl?: () => Promise<string>;
  signEvent?: EventSigner;
  fetch?: FetchImplementation;
};

export class StaffFamilyDirectoryApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StaffFamilyDirectoryApiError";
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

function requestUrl(baseUrl: string, query: StaffFamilyDirectoryQuery): string {
  const url = new URL(
    `${baseUrl.replace(/\/+$/, "")}/api/airhop/staff/v1/families`,
  );
  if (query.status) url.searchParams.set("status", query.status);
  const search = query.search?.trim();
  if (search) {
    if ([...search].length > 100) {
      throw new StaffFamilyDirectoryApiError(
        400,
        "The AirHub family search must be at most 100 characters.",
      );
    }
    url.searchParams.set("search", search);
  }
  if (query.limit !== undefined) {
    if (
      !Number.isInteger(query.limit) ||
      query.limit < 1 ||
      query.limit > 100
    ) {
      throw new StaffFamilyDirectoryApiError(
        400,
        "The AirHub family directory limit must be between 1 and 100.",
      );
    }
    url.searchParams.set("limit", String(query.limit));
  }
  if (query.cursor) {
    url.searchParams.set("cursorSortName", query.cursor.sortName);
    url.searchParams.set("cursorFamilyId", query.cursor.familyId);
  }
  return url.toString();
}

/** NIP-98 client for the authoritative staff family directory. */
export class HttpStaffFamilyDirectoryService
  implements StaffFamilyDirectoryService
{
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;

  constructor(options: HttpStaffFamilyDirectoryServiceOptions = {}) {
    this.relayHttpUrl = options.relayHttpUrl ?? getRelayHttpUrl;
    this.signEvent = options.signEvent ?? signRelayEvent;
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
  }

  async listFamilies(
    query: StaffFamilyDirectoryQuery = {},
  ): Promise<StaffFamilyDirectoryPage> {
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
      throw new StaffFamilyDirectoryApiError(response.status, message);
    }
    const parsed = directoryPageSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffFamilyDirectoryApiError(
        502,
        "The AirHub family directory API returned invalid data.",
      );
    }
    return parsed.data;
  }
}

export function createHttpStaffFamilyDirectoryService(): StaffFamilyDirectoryService {
  return new HttpStaffFamilyDirectoryService();
}
