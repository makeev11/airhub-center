import { z } from "zod";

import {
  bookingSourceChannelSchema,
  organizationSchema,
  type PaymentMethod,
  paymentTransactionSchema,
  paymentExpectationSchema,
} from "@/features/booking/model/bookingCore";
import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;
const PAYMENTS_PATH = "/api/airhop/staff/v1/payments";
const PAYMENT_ANALYTICS_PATH = "/api/airhop/staff/v1/payment-analytics";
const BOOKING_FUNNEL_ANALYTICS_PATH =
  "/api/airhop/staff/v1/booking-funnel-analytics";

const serverPaymentTransactionSchema = paymentTransactionSchema.extend({
  id: z.string().uuid(),
  paymentExpectationId: z.string().uuid(),
});

const serverPaymentSchema = paymentExpectationSchema.safeExtend({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  familyId: z.string().uuid(),
  childId: z.string().uuid(),
  enrollmentId: z.string().uuid(),
  tariffId: z.string().uuid(),
  version: z.number().int().positive(),
  paidMinor: z.number().int().nonnegative().safe(),
  outstandingMinor: z.number().int().nonnegative().safe(),
  transactions: z.array(serverPaymentTransactionSchema),
});

const paymentQueueItemSchema = z.object({
  payment: serverPaymentSchema,
  family: z.object({
    id: z.string().uuid(),
    displayName: z.string().trim().min(1).max(200),
  }),
  child: z.object({
    id: z.string().uuid(),
    displayName: z.string().trim().min(1).max(160),
  }),
  enrollment: z.object({ id: z.string().uuid() }),
  group: z.object({
    id: z.string().uuid(),
    name: z.string().trim().min(1).max(200),
  }),
});

const paymentQueueSchema = z.object({
  organization: organizationSchema,
  items: z.array(paymentQueueItemSchema),
});

const analyticsAmountSchema = z.number().int().nonnegative().safe();
const analyticsCountSchema = z.number().int().nonnegative().safe();
const paymentAnalyticsPeriodSchema = z.object({
  periodStart: z.iso.date(),
  scheduledCount: analyticsCountSchema,
  scheduledMinor: analyticsAmountSchema,
  paidCount: analyticsCountSchema,
  paidMinor: analyticsAmountSchema,
  outstandingCount: analyticsCountSchema,
  outstandingMinor: analyticsAmountSchema,
  overdueCount: analyticsCountSchema,
  overdueMinor: analyticsAmountSchema,
  cancelledCount: analyticsCountSchema,
  cancelledMinor: analyticsAmountSchema,
  paidShareBps: z.number().int().min(0).max(10_000).nullable(),
});
const paymentAnalyticsCurrencySchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  openCount: analyticsCountSchema,
  openMinor: analyticsAmountSchema,
  overdueCount: analyticsCountSchema,
  overdueMinor: analyticsAmountSchema,
  periods: z.array(paymentAnalyticsPeriodSchema).length(6),
});
const paymentAnalyticsSchema = z.object({
  organization: organizationSchema,
  analytics: z.object({
    asOfDate: z.iso.date(),
    currencies: z.array(paymentAnalyticsCurrencySchema),
  }),
});

const bookingFunnelStagesSchema = z.object({
  trialBookings: analyticsCountSchema,
  confirmedTrials: analyticsCountSchema,
  attendedTrials: analyticsCountSchema,
  permanentEnrollments: analyticsCountSchema,
  firstPaymentsPaid: analyticsCountSchema,
});
const bookingFunnelCurrencyAmountSchema = z.object({
  currency: z.string().regex(/^[A-Z]{3}$/),
  paidCount: analyticsCountSchema,
  paidMinor: analyticsAmountSchema,
});
const bookingFunnelSegmentSchema = z.object({
  sourceChannel: bookingSourceChannelSchema,
  branchId: z.string().uuid(),
  branchName: z.string().trim().min(1).max(200),
  stages: bookingFunnelStagesSchema,
  firstPaidCurrencies: z.array(bookingFunnelCurrencyAmountSchema),
});
const bookingFunnelPeriodSchema = z.object({
  periodStart: z.iso.date(),
  stages: bookingFunnelStagesSchema,
  firstPaidCurrencies: z.array(bookingFunnelCurrencyAmountSchema),
  segments: z.array(bookingFunnelSegmentSchema),
});
const bookingFunnelAnalyticsSchema = z.object({
  organization: organizationSchema,
  analytics: z.object({
    asOfDate: z.iso.date(),
    periods: z.array(bookingFunnelPeriodSchema).length(6),
  }),
});

const mutationOutcomeSchema = z.object({
  paymentId: z.string().uuid(),
  version: z.number().int().positive(),
  replayed: z.boolean(),
});

export type StaffPaymentQueueItem = z.infer<typeof paymentQueueItemSchema>;
export type StaffPaymentQueue = z.infer<typeof paymentQueueSchema>;
export type StaffPaymentAnalytics = z.infer<typeof paymentAnalyticsSchema>;
export type StaffPaymentAnalyticsCurrency = z.infer<
  typeof paymentAnalyticsCurrencySchema
>;
export type StaffPaymentAnalyticsPeriod = z.infer<
  typeof paymentAnalyticsPeriodSchema
>;
export type StaffBookingFunnelAnalytics = z.infer<
  typeof bookingFunnelAnalyticsSchema
>;
export type StaffBookingFunnelPeriod = z.infer<
  typeof bookingFunnelPeriodSchema
>;
export type StaffBookingFunnelSegment = z.infer<
  typeof bookingFunnelSegmentSchema
>;
export type StaffBookingFunnelStages = z.infer<
  typeof bookingFunnelStagesSchema
>;
export type StaffPaymentMutationOutcome = z.infer<typeof mutationOutcomeSchema>;

export type StaffPaymentMutation =
  | { action: "mark_paid" }
  | { action: "cancel"; reason: string }
  | {
      action: "record_payment";
      amountMinor: number;
      method: Exclude<PaymentMethod, "buzz" | "legacy">;
      note?: string;
    }
  | {
      action: "refund_payment";
      amountMinor: number;
      reason: string;
    }
  | { action: "restore"; reason: string }
  | { action: "change_amount"; amountMinor: number }
  | { action: "move_due_date"; dueDate: string; reason: string };

export interface StaffPaymentService {
  listPayments(): Promise<StaffPaymentQueue>;
  getPaymentAnalytics(): Promise<StaffPaymentAnalytics>;
  getBookingFunnelAnalytics(): Promise<StaffBookingFunnelAnalytics>;
  mutatePayment(input: {
    paymentId: string;
    expectedVersion: number;
    mutation: StaffPaymentMutation;
  }): Promise<StaffPaymentMutationOutcome>;
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
  nonceFactory?: () => string;
};

/** HTTP failure returned by the authoritative AirHub payment endpoints. */
export class StaffPaymentApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StaffPaymentApiError";
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

/** NIP-98 client for payment queue reads and audited payment commands. */
export class HttpStaffPaymentService implements StaffPaymentService {
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;
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

  async listPayments(): Promise<StaffPaymentQueue> {
    const url = await this.url(PAYMENTS_PATH);
    const response = await this.fetchImplementation(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: await authorization(
          "GET",
          url,
          undefined,
          this.nonceFactory(),
          this.signEvent,
        ),
      },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw this.apiError(response, payload);
    const parsed = paymentQueueSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffPaymentApiError(
        502,
        "The AirHub payment queue API returned invalid data.",
      );
    }
    return parsed.data;
  }

  async getPaymentAnalytics(): Promise<StaffPaymentAnalytics> {
    const url = await this.url(PAYMENT_ANALYTICS_PATH);
    const response = await this.fetchImplementation(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: await authorization(
          "GET",
          url,
          undefined,
          this.nonceFactory(),
          this.signEvent,
        ),
      },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw this.apiError(response, payload);
    const parsed = paymentAnalyticsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffPaymentApiError(
        502,
        "The AirHub payment analytics API returned invalid data.",
      );
    }
    return parsed.data;
  }

  async getBookingFunnelAnalytics(): Promise<StaffBookingFunnelAnalytics> {
    const url = await this.url(BOOKING_FUNNEL_ANALYTICS_PATH);
    const response = await this.fetchImplementation(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: await authorization(
          "GET",
          url,
          undefined,
          this.nonceFactory(),
          this.signEvent,
        ),
      },
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw this.apiError(response, payload);
    const parsed = bookingFunnelAnalyticsSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffPaymentApiError(
        502,
        "The AirHub booking funnel analytics API returned invalid data.",
      );
    }
    return parsed.data;
  }

  async mutatePayment(input: {
    paymentId: string;
    expectedVersion: number;
    mutation: StaffPaymentMutation;
  }): Promise<StaffPaymentMutationOutcome> {
    const paymentId = z.string().uuid().safeParse(input.paymentId);
    if (!paymentId.success || !Number.isInteger(input.expectedVersion)) {
      throw new StaffPaymentApiError(400, "Invalid AirHub payment identity.");
    }
    const path = `${PAYMENTS_PATH}/${encodeURIComponent(paymentId.data)}`;
    const url = await this.url(path);
    const body = JSON.stringify({
      ...input.mutation,
      expectedVersion: input.expectedVersion,
    });
    const response = await this.fetchImplementation(url, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        Authorization: await authorization(
          "PUT",
          url,
          body,
          this.nonceFactory(),
          this.signEvent,
        ),
        "Content-Type": "application/json",
        "Idempotency-Key": this.idempotencyKeyFactory(),
      },
      body,
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw this.apiError(response, payload);
    const parsed = mutationOutcomeSchema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffPaymentApiError(
        502,
        "The AirHub payment command returned invalid data.",
      );
    }
    return parsed.data;
  }

  private async url(path: string): Promise<string> {
    return `${(await this.relayHttpUrl()).replace(/\/+$/, "")}${path}`;
  }

  private apiError(response: Response, payload: unknown): StaffPaymentApiError {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `HTTP ${response.status}`;
    return new StaffPaymentApiError(response.status, message);
  }
}

export function createHttpStaffPaymentService(): StaffPaymentService {
  return new HttpStaffPaymentService();
}
