import { z } from "zod";

import {
  BookingRevisionConflictError,
  type BookingRepository,
} from "@/features/booking/data/bookingRepository";
import { detectBookingTimeZone } from "@/features/booking/lib/bookingTimeZones";
import {
  organizationSchema,
  parseBookingWorkspace,
  type BookingOrganization,
  type BookingWorkspace,
  type BookingWorkspaceDraft,
} from "@/features/booking/model/bookingCore";
import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;
const SETTINGS_PATH = "/api/airhop/staff/v1/settings";

const settingsResponseSchema = z.object({
  organization: organizationSchema,
  version: z.number().int().positive(),
  replayed: z.boolean(),
});

type EventSigner = (input: {
  kind: number;
  content: string;
  tags: string[][];
}) => Promise<RelayEvent>;

type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

type HttpBookingSettingsRepositoryOptions = {
  relayHttpUrl?: () => Promise<string>;
  signEvent?: EventSigner;
  fetch?: FetchImplementation;
  idempotencyKeyFactory?: () => string;
  nonceFactory?: () => string;
  initialOrganization?: () => BookingOrganization;
};

/** HTTP failure returned by the authoritative AirHub settings endpoint. */
export class BookingSettingsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BookingSettingsApiError";
    this.status = status;
  }
}

function emptyWorkspace(
  organization: BookingOrganization,
  revision: number,
): BookingWorkspace {
  return parseBookingWorkspace({
    schemaVersion: 8,
    revision,
    organization,
    branches: [],
    rooms: [],
    teachers: [],
    groups: [],
    recurrenceRules: [],
    lessonExceptions: [],
    families: [],
    representatives: [],
    children: [],
    duplicateCandidates: [],
    bookings: [],
    tariffs: [],
    enrollments: [],
    paymentExpectations: [],
    intakeRequests: [],
    pendingActions: [],
    attendanceRecords: [],
  });
}

function defaultInitialOrganization(): BookingOrganization {
  return organizationSchema.parse({
    id: "unconfigured",
    name: "Новый центр",
    locale: "ru-RU",
    timeZone: detectBookingTimeZone(),
    staffWorkingHours: {
      monday: [{ startTime: "09:00", endTime: "18:00" }],
      tuesday: [{ startTime: "09:00", endTime: "18:00" }],
      wednesday: [{ startTime: "09:00", endTime: "18:00" }],
      thursday: [{ startTime: "09:00", endTime: "18:00" }],
      friday: [{ startTime: "09:00", endTime: "18:00" }],
      saturday: [],
      sunday: [],
    },
    defaultTrialPolicy: { mode: "free" },
    trackAttendanceByDefault: true,
    allowSingleVisitsByDefault: false,
    existingStudentsOnboarding: { status: "not_started" },
    publicBooking: { purpose: "trial", appearance: "automatic" },
    paymentDayOfMonth: 5,
  });
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

async function nip98Authorization(
  method: "GET" | "PUT",
  url: string,
  body: string | undefined,
  nonce: string,
  signEvent: EventSigner,
): Promise<string> {
  const tags = [
    ["u", url],
    ["method", method],
    ["nonce", nonce],
  ];
  if (body !== undefined) tags.push(["payload", await sha256Hex(body)]);
  const event = await signEvent({ kind: NIP98_KIND, content: "", tags });
  return `Nostr ${base64Utf8(JSON.stringify(event))}`;
}

async function errorMessage(
  response: Response,
  payload: unknown,
): Promise<string> {
  if (
    typeof payload === "object" &&
    payload !== null &&
    "error" in payload &&
    typeof payload.error === "string"
  ) {
    return payload.error;
  }
  return `HTTP ${response.status}`;
}

/** Server-backed repository used only by the organization settings surface. */
export class HttpBookingSettingsRepository implements BookingRepository {
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;
  private readonly idempotencyKeyFactory: () => string;
  private readonly nonceFactory: () => string;
  private readonly initialOrganization: () => BookingOrganization;

  constructor(options: HttpBookingSettingsRepositoryOptions = {}) {
    this.relayHttpUrl = options.relayHttpUrl ?? getRelayHttpUrl;
    this.signEvent = options.signEvent ?? signRelayEvent;
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
    this.idempotencyKeyFactory =
      options.idempotencyKeyFactory ?? (() => crypto.randomUUID());
    this.nonceFactory = options.nonceFactory ?? (() => crypto.randomUUID());
    this.initialOrganization =
      options.initialOrganization ?? defaultInitialOrganization;
  }

  async load(): Promise<BookingWorkspace> {
    const url = await this.settingsUrl();
    const authorization = await nip98Authorization(
      "GET",
      url,
      undefined,
      this.nonceFactory(),
      this.signEvent,
    );
    const response = await this.fetchImplementation(url, {
      method: "GET",
      headers: { Accept: "application/json", Authorization: authorization },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (response.status === 404) {
      return emptyWorkspace(this.initialOrganization(), 0);
    }
    if (!response.ok) {
      throw new BookingSettingsApiError(
        response.status,
        await errorMessage(response, payload),
      );
    }
    return this.workspaceFromResponse(payload);
  }

  async save(
    draft: BookingWorkspaceDraft,
    expectedRevision: number,
  ): Promise<BookingWorkspace> {
    const organization = organizationSchema.parse(draft.organization);
    const url = await this.settingsUrl();
    const body = JSON.stringify({
      expectedVersion: expectedRevision,
      name: organization.name,
      locale: organization.locale,
      timeZone: organization.timeZone,
      staffWorkingHours: organization.staffWorkingHours,
      defaultTrialPolicy: organization.defaultTrialPolicy,
      trackAttendanceByDefault: organization.trackAttendanceByDefault,
      allowSingleVisitsByDefault: organization.allowSingleVisitsByDefault,
      existingStudentsOnboardingStatus:
        organization.existingStudentsOnboarding.status,
      publicBookingPurpose: organization.publicBooking.purpose,
      publicBookingAppearance: organization.publicBooking.appearance,
      paymentDayOfMonth: organization.paymentDayOfMonth,
      ...(organization.paymentsBuzzChannelId
        ? { paymentsBuzzChannelId: organization.paymentsBuzzChannelId }
        : {}),
      ...(organization.analyticsBuzzChannelId
        ? { analyticsBuzzChannelId: organization.analyticsBuzzChannelId }
        : {}),
    });
    const authorization = await nip98Authorization(
      "PUT",
      url,
      body,
      this.nonceFactory(),
      this.signEvent,
    );
    const response = await this.fetchImplementation(url, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        Authorization: authorization,
        "Content-Type": "application/json",
        "Idempotency-Key": this.idempotencyKeyFactory(),
      },
      body,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (response.status === 409) {
      const latest = await this.load();
      throw new BookingRevisionConflictError(expectedRevision, latest.revision);
    }
    if (!response.ok) {
      throw new BookingSettingsApiError(
        response.status,
        await errorMessage(response, payload),
      );
    }
    return this.workspaceFromResponse(payload);
  }

  private async settingsUrl(): Promise<string> {
    const baseUrl = (await this.relayHttpUrl()).replace(/\/+$/, "");
    return `${baseUrl}${SETTINGS_PATH}`;
  }

  private workspaceFromResponse(payload: unknown): BookingWorkspace {
    const parsed = settingsResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BookingSettingsApiError(
        502,
        "The AirHub settings API returned invalid data.",
      );
    }
    return emptyWorkspace(parsed.data.organization, parsed.data.version);
  }
}

export function createHttpBookingSettingsRepository(): BookingRepository {
  return new HttpBookingSettingsRepository();
}
