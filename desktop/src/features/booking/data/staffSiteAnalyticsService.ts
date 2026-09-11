import { z } from "zod";
import {
  staffCenterAnalyticsSchema,
  type AnalyticsUntil,
  type StaffCenterAnalytics,
} from "./centerAnalyticsSchema";

import { organizationSchema } from "@/features/booking/model/bookingCore";
import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;
const SITE_ANALYTICS_PATH = "/api/airhop/staff/v1/site-analytics";
const TRACKING_LINKS_PATH = "/api/airhop/staff/v1/tracking-links";

const countSchema = z.number().int().nonnegative().safe();
const siteAnalyticsSchema = z.object({
  organization: organizationSchema,
  analytics: z.object({
    periodStart: z.iso.date(),
    asOfDate: z.iso.date(),
    generatedAt: z.iso.datetime({ offset: true }),
    timeZone: z.string().min(1),
    firstEventAt: z.iso.datetime({ offset: true }).nullable(),
    lastEventAt: z.iso.datetime({ offset: true }).nullable(),
    pagesTruncated: z.boolean(),
    sourcesTruncated: z.boolean(),
    siteFunnel: z.object({
      viewedSessions: countSchema,
      bookingSessions: countSchema,
      contactSessions: countSchema,
      bookedSessions: countSchema,
    }),
    pages: z.array(
      z.object({
        path: z.string(),
        views: countSchema,
        contactClicks: countSchema,
      }),
    ),
    contacts: z.array(
      z.object({
        target: z.enum([
          "phone",
          "email",
          "telegram",
          "whatsapp",
          "max",
          "other",
        ]),
        clicks: countSchema,
      }),
    ),
    totals: z.object({
      visitors: countSchema,
      sessions: countSchema,
      pageViews: countSchema,
      bookingOpens: countSchema,
      bookingsCreated: countSchema,
      contactClicks: countSchema,
      bookingConversionBps: z.number().int().min(0).max(10_000).nullable(),
    }),
    days: z.array(
      z.object({
        date: z.iso.date(),
        visitors: countSchema,
        sessions: countSchema,
        bookingsCreated: countSchema,
        contactClicks: countSchema,
      }),
    ),
    funnel: z.object({
      opened: countSchema,
      basicsCompleted: countSchema,
      groupsCompleted: countSchema,
      occurrencesCompleted: countSchema,
      contactCompleted: countSchema,
      previewCompleted: countSchema,
      submitted: countSchema,
      created: countSchema,
    }),
    sources: z.array(
      z.object({
        source: z.string().trim().min(1).max(160),
        sessions: countSchema,
        trackedLinkOpens: countSchema,
        bookingsCreated: countSchema,
        contactClicks: countSchema,
      }),
    ),
  }),
});

const trackingLinkSourceSchema = z.enum([
  "yandex_maps",
  "google_maps",
  "two_gis",
  "qr",
  "campaign",
  "custom",
]);
const trackingLinkGoalSchema = z.enum(["site", "booking", "contact"]);
const trackingLinkSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(3).max(80),
  name: z.string().trim().min(1).max(160),
  source: trackingLinkSourceSchema,
  goal: trackingLinkGoalSchema,
  destinationPath: z.string().startsWith("/").max(512),
  branchId: z.string().uuid().nullable(),
  status: z.enum(["active", "archived"]),
  version: z.number().int().positive(),
  openCount: countSchema,
  bookingCount: countSchema,
  contactClickCount: countSchema,
  createdAt: z.string().datetime({ offset: true }),
});
const trackingLinksSchema = z.object({
  redirectPath: z.literal("/go/"),
  items: z.array(trackingLinkSchema),
});
const createTrackingLinkSchema = z.object({
  link: trackingLinkSchema,
  replayed: z.boolean(),
});

export type StaffSiteAnalytics = z.infer<typeof siteAnalyticsSchema>;
export type StaffSiteAnalyticsReport = StaffSiteAnalytics["analytics"];
export type TrackingLink = z.infer<typeof trackingLinkSchema>;
export type TrackingLinkSource = z.infer<typeof trackingLinkSourceSchema>;
export type TrackingLinkGoal = z.infer<typeof trackingLinkGoalSchema>;
export type TrackingLinkList = {
  redirectBaseUrl: string;
  items: TrackingLink[];
};
export type CreateTrackingLink = {
  name: string;
  source: TrackingLinkSource;
  goal: TrackingLinkGoal;
  destinationPath: string;
  branchId?: string;
};

type EventSigner = (input: {
  kind: number;
  content: string;
  tags: string[][];
}) => Promise<RelayEvent>;

type Options = {
  relayHttpUrl?: () => Promise<string>;
  signEvent?: EventSigner;
  fetch?: typeof globalThis.fetch;
  idempotencyKeyFactory?: () => string;
  nonceFactory?: () => string;
};

export interface StaffSiteAnalyticsService {
  getSiteAnalytics(
    days?: number,
    until?: AnalyticsUntil,
  ): Promise<StaffSiteAnalytics>;
  getCenterAnalytics(
    days?: number,
    until?: AnalyticsUntil,
  ): Promise<StaffCenterAnalytics>;
  listTrackingLinks(): Promise<TrackingLinkList>;
  createTrackingLink(input: CreateTrackingLink): Promise<TrackingLink>;
}

export class StaffSiteAnalyticsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StaffSiteAnalyticsApiError";
    this.status = status;
  }
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
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

async function authorization(
  method: "GET" | "POST",
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

export class HttpStaffSiteAnalyticsService
  implements StaffSiteAnalyticsService
{
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: typeof globalThis.fetch;
  private readonly idempotencyKeyFactory: () => string;
  private readonly nonceFactory: () => string;

  constructor(options: Options = {}) {
    this.relayHttpUrl = options.relayHttpUrl ?? getRelayHttpUrl;
    this.signEvent = options.signEvent ?? signRelayEvent;
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
    this.idempotencyKeyFactory =
      options.idempotencyKeyFactory ?? (() => crypto.randomUUID());
    this.nonceFactory = options.nonceFactory ?? (() => crypto.randomUUID());
  }

  async getCenterAnalytics(
    days = 30,
    until: AnalyticsUntil = "today",
  ): Promise<StaffCenterAnalytics> {
    if (
      !Number.isInteger(days) ||
      days < 1 ||
      days > 366 ||
      !["today", "yesterday"].includes(until)
    ) {
      throw new StaffSiteAnalyticsApiError(400, "Invalid analytics period.");
    }
    const payload = await this.request(
      "GET",
      `/api/airhop/staff/v1/booking-funnel-analytics?view=center&days=${days}&until=${until}`,
    );
    const parsed = staffCenterAnalyticsSchema.safeParse(payload);
    if (!parsed.success)
      throw new StaffSiteAnalyticsApiError(
        502,
        "The AirHub center analytics API returned invalid data.",
      );
    return parsed.data;
  }

  async getSiteAnalytics(
    days = 30,
    until: AnalyticsUntil = "today",
  ): Promise<StaffSiteAnalytics> {
    if (
      !Number.isInteger(days) ||
      days < 1 ||
      days > 366 ||
      !["today", "yesterday"].includes(until)
    ) {
      throw new StaffSiteAnalyticsApiError(400, "Invalid analytics period.");
    }
    const payload = await this.request(
      "GET",
      `${SITE_ANALYTICS_PATH}?days=${days}${until === "yesterday" ? "&until=yesterday" : ""}`,
    );
    const parsed = siteAnalyticsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffSiteAnalyticsApiError(
        502,
        "The AirHub site analytics API returned invalid data.",
      );
    }
    return parsed.data;
  }

  async listTrackingLinks(): Promise<TrackingLinkList> {
    const baseUrl = (await this.relayHttpUrl()).replace(/\/+$/, "");
    const payload = await this.request(
      "GET",
      TRACKING_LINKS_PATH,
      undefined,
      baseUrl,
    );
    const parsed = trackingLinksSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffSiteAnalyticsApiError(
        502,
        "The AirHub tracking links API returned invalid data.",
      );
    }
    return {
      redirectBaseUrl: `${baseUrl}${parsed.data.redirectPath}`,
      items: parsed.data.items,
    };
  }

  async createTrackingLink(input: CreateTrackingLink): Promise<TrackingLink> {
    const body = JSON.stringify(input);
    const payload = await this.request("POST", TRACKING_LINKS_PATH, body);
    const parsed = createTrackingLinkSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffSiteAnalyticsApiError(
        502,
        "The AirHub tracking link command returned invalid data.",
      );
    }
    return parsed.data.link;
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body?: string,
    knownBaseUrl?: string,
  ): Promise<unknown> {
    const baseUrl =
      knownBaseUrl ?? (await this.relayHttpUrl()).replace(/\/+$/, "");
    const url = `${baseUrl}${path}`;
    const response = await this.fetchImplementation(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: await authorization(
          method,
          url,
          body,
          this.nonceFactory(),
          this.signEvent,
        ),
        ...(body
          ? {
              "Content-Type": "application/json",
              "Idempotency-Key": this.idempotencyKeyFactory(),
            }
          : {}),
      },
      ...(body ? { body } : {}),
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
      throw new StaffSiteAnalyticsApiError(response.status, message);
    }
    return payload;
  }
}

export function createHttpStaffSiteAnalyticsService(): StaffSiteAnalyticsService {
  return new HttpStaffSiteAnalyticsService();
}
