import { z } from "zod";

import {
  PublicBookingAgeMismatchError,
  PublicBookingTransitionError,
  PublicBookingUnavailableError,
  PublicBookingValidationError,
  type CreatePublicBookingCommand,
  type CreatePublicBookingResult,
  type PublicBookingCatalog,
  type PublicBookingManagementCard,
  type PublicBookingService,
} from "@/features/booking/data/publicBookingService";
import type {
  PublicBookingOccurrence,
  PublicOccurrenceSearchFilters,
} from "@/features/booking/lib/publicBookingAvailability";
import {
  bookingIdSchema,
  bookingStatusSchema,
  bookingTransferRequestSchema,
  isoDateSchema,
  localTimeSchema,
  preferredContactChannelSchema,
  publicBookingAppearanceSchema,
  publicBookingPurposeSchema,
  stableLessonReferenceSchema,
  trialPolicySchema,
} from "@/features/booking/model/bookingCore";
import { PUBLIC_BOOKING_CONSENT_VERSION } from "@/features/booking/model/publicBooking";

const MANAGEMENT_TOKEN_PATTERN = /^ahb_[1-9]\d*_[A-Za-z0-9_-]{43}$/;

const catalogResponseSchema = z.object({
  organization: z.object({
    id: bookingIdSchema,
    name: z.string().trim().min(1),
    locale: z.string().trim().min(2),
    timeZone: z.string().trim().min(1),
    currentDate: isoDateSchema,
    publicBooking: z.object({
      purpose: publicBookingPurposeSchema,
      appearance: publicBookingAppearanceSchema,
      consentPolicyVersion: z.literal(PUBLIC_BOOKING_CONSENT_VERSION),
    }),
  }),
  branches: z.array(
    z.object({
      id: bookingIdSchema,
      name: z.string().trim().min(1),
      address: z.string(),
    }),
  ),
});

const occurrenceSchema = z.object({
  lessonRef: stableLessonReferenceSchema,
  groupId: bookingIdSchema,
  groupName: z.string().trim().min(1),
  groupDescription: z.string().optional(),
  minAgeMonths: z.number().int().nonnegative().optional(),
  maxAgeMonths: z.number().int().nonnegative().optional(),
  branchId: bookingIdSchema,
  branchName: z.string().trim().min(1),
  branchAddress: z.string(),
  roomName: z.string().optional(),
  teacherNames: z.array(z.string().trim().min(1)),
  date: isoDateSchema,
  startTime: localTimeSchema,
  endTime: localTimeSchema,
  trialPolicy: trialPolicySchema,
  capacity: z.number().int().nonnegative().nullable(),
  occupied: z.number().int().nonnegative(),
  remaining: z.number().int().nonnegative().nullable(),
  available: z.boolean(),
});

const occurrencesResponseSchema = z.object({
  occurrences: z.array(occurrenceSchema),
});

const managementCardSchema = z.object({
  status: bookingStatusSchema,
  childName: z.string().trim().min(1),
  maskedPhone: z.string().min(1),
  preferredContactChannel: preferredContactChannelSchema,
  transferRequest: bookingTransferRequestSchema.nullable().default(null),
  organizationName: z.string().trim().min(1),
  branchName: z.string().trim().min(1),
  branchAddress: z.string(),
  groupName: z.string().trim().min(1),
  roomName: z.string().optional(),
  teacherNames: z.array(z.string().trim().min(1)),
  date: isoDateSchema,
  startTime: localTimeSchema,
  endTime: localTimeSchema,
  trialPolicy: trialPolicySchema,
  purpose: publicBookingPurposeSchema,
  canCancel: z.boolean(),
  canRequestTransfer: z.boolean(),
});

const createResponseSchema = z.object({
  managementToken: z.string().regex(MANAGEMENT_TOKEN_PATTERN),
});

const errorEnvelopeSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    retryable: z.boolean(),
  }),
});

type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

type HttpPublicBookingServiceOptions = {
  basePath?: string;
  fetch?: FetchImplementation;
  idempotencyKeyFactory?: () => string;
};

class PublicBookingApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;

  constructor(
    status: number,
    code: string,
    message: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = "PublicBookingApiError";
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

/** Same-origin adapter for the relay-owned public booking API. */
export class HttpPublicBookingService implements PublicBookingService {
  private readonly basePath: string;
  private readonly fetchImplementation: FetchImplementation;
  private readonly idempotencyKeyFactory: () => string;
  private catalogPurpose:
    | PublicBookingCatalog["organization"]["publicBooking"]["purpose"]
    | null = null;

  constructor(options: HttpPublicBookingServiceOptions = {}) {
    this.basePath = (options.basePath ?? "/api/airhop/public/v1").replace(
      /\/$/,
      "",
    );
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
    this.idempotencyKeyFactory =
      options.idempotencyKeyFactory ?? (() => crypto.randomUUID());
  }

  async getCatalog(): Promise<PublicBookingCatalog> {
    const response = await this.request("/catalog", catalogResponseSchema);
    this.catalogPurpose = response.organization.publicBooking.purpose;
    return {
      organization: {
        id: response.organization.id,
        name: response.organization.name,
        locale: response.organization.locale,
        timeZone: response.organization.timeZone,
        currentDate: response.organization.currentDate,
        publicBooking: {
          purpose: response.organization.publicBooking.purpose,
          appearance: response.organization.publicBooking.appearance,
        },
      },
      branches: response.branches,
    };
  }

  async findOccurrences(
    filters: PublicOccurrenceSearchFilters,
  ): Promise<PublicBookingOccurrence[]> {
    const query = new URLSearchParams();
    if (filters.branchId) query.set("branchId", filters.branchId);
    if (filters.groupId) query.set("groupId", filters.groupId);
    if (filters.birthYear !== undefined)
      query.set("birthYear", String(filters.birthYear));
    if (filters.birthMonth !== undefined)
      query.set("birthMonth", String(filters.birthMonth));
    if (filters.ageYears !== undefined)
      query.set("ageYears", String(filters.ageYears));
    if (filters.purpose) query.set("purpose", filters.purpose);
    const suffix = query.size ? `?${query.toString()}` : "";
    const response = await this.request(
      `/occurrences${suffix}`,
      occurrencesResponseSchema,
    );
    return response.occurrences;
  }

  async createBooking(
    command: CreatePublicBookingCommand,
  ): Promise<CreatePublicBookingResult> {
    const serverPurpose =
      this.catalogPurpose ??
      (await this.getCatalog()).organization.publicBooking.purpose;
    if (command.purpose !== serverPurpose) {
      throw new PublicBookingApiError(
        409,
        "purpose_mismatch",
        "The public booking purpose differs from the server configuration.",
        false,
      );
    }
    let response: z.infer<typeof createResponseSchema>;
    try {
      response = await this.request("/bookings", createResponseSchema, {
        method: "POST",
        headers: this.commandHeaders(command.idempotencyKey),
        body: JSON.stringify({
          lessonRef: command.lessonRef,
          applicant: {
            parentName: command.applicant.parentName,
            phone: command.applicant.phone,
            childName: command.applicant.childName,
            childBirthDate: command.applicant.childBirthDate,
            consentAccepted: command.applicant.consentAccepted,
            consentPolicyVersion: PUBLIC_BOOKING_CONSENT_VERSION,
          },
          preferredContactChannel: command.preferredContactChannel ?? "none",
          source: command.source,
        }),
      });
    } catch (error) {
      throw mapCreateError(error);
    }
    const card = await this.getManagementCard(response.managementToken);
    if (!card) {
      throw new PublicBookingApiError(
        502,
        "management_card_unavailable",
        "The booking was created but its management card is unavailable.",
        true,
      );
    }
    return { managementToken: response.managementToken, card };
  }

  async getManagementCard(
    managementToken: string,
  ): Promise<PublicBookingManagementCard | null> {
    if (!MANAGEMENT_TOKEN_PATTERN.test(managementToken)) return null;
    return this.managementRequest(managementToken, "", { method: "GET" });
  }

  async cancelByParent(
    managementToken: string,
  ): Promise<PublicBookingManagementCard | null> {
    return this.managementRequest(managementToken, "/cancel", {
      method: "POST",
      headers: this.commandHeaders(this.idempotencyKeyFactory()),
      body: "{}",
    });
  }

  async requestTransfer(
    managementToken: string,
    comment?: string,
  ): Promise<PublicBookingManagementCard | null> {
    return this.managementRequest(managementToken, "/transfer-request", {
      method: "POST",
      headers: this.commandHeaders(this.idempotencyKeyFactory()),
      body: JSON.stringify({ ...(comment ? { comment } : {}) }),
    });
  }

  async setPreferredContactChannel(
    managementToken: string,
    channel: z.infer<typeof preferredContactChannelSchema>,
  ): Promise<PublicBookingManagementCard | null> {
    return this.managementRequest(managementToken, "/contact-channel", {
      method: "POST",
      headers: this.commandHeaders(this.idempotencyKeyFactory()),
      body: JSON.stringify({ channel }),
    });
  }

  private async managementRequest(
    managementToken: string,
    actionPath: string,
    init: RequestInit,
  ): Promise<PublicBookingManagementCard | null> {
    if (!MANAGEMENT_TOKEN_PATTERN.test(managementToken)) return null;
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${managementToken}`);
    try {
      return await this.request(`/manage${actionPath}`, managementCardSchema, {
        ...init,
        headers,
      });
    } catch (error) {
      if (
        error instanceof PublicBookingApiError &&
        error.code === "management_token_invalid"
      ) {
        return null;
      }
      if (
        error instanceof PublicBookingApiError &&
        error.code === "booking_transition_invalid"
      ) {
        throw new PublicBookingTransitionError();
      }
      throw error;
    }
  }

  private commandHeaders(idempotencyKey: string): Headers {
    const headers = new Headers();
    headers.set("Accept", "application/json");
    headers.set("Content-Type", "application/json");
    headers.set("Idempotency-Key", idempotencyKey);
    return headers;
  }

  private async request<T>(
    path: string,
    schema: z.ZodType<T>,
    init: RequestInit = {},
  ): Promise<T> {
    const headers = new Headers(init.headers);
    headers.set("Accept", "application/json");
    const response = await this.fetchImplementation(`${this.basePath}${path}`, {
      ...init,
      credentials: "same-origin",
      headers,
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      const envelope = errorEnvelopeSchema.safeParse(payload);
      throw new PublicBookingApiError(
        response.status,
        envelope.success ? envelope.data.error.code : "invalid_api_response",
        envelope.success
          ? envelope.data.error.message
          : "The booking service returned an invalid error response.",
        envelope.success && envelope.data.error.retryable,
      );
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new PublicBookingApiError(
        502,
        "invalid_api_response",
        "The booking service returned invalid data.",
        true,
      );
    }
    return parsed.data;
  }
}

function mapCreateError(error: unknown): Error {
  if (!(error instanceof PublicBookingApiError)) {
    return error instanceof Error ? error : new Error("Public booking failed");
  }
  if (error.code === "age_mismatch") return new PublicBookingAgeMismatchError();
  if (
    [
      "capacity_full",
      "occurrence_unavailable",
      "visit_disabled",
      "booking_conflict",
    ].includes(error.code)
  ) {
    return new PublicBookingUnavailableError();
  }
  if (error.code === "phone_invalid") {
    return new PublicBookingValidationError(["phone_invalid"]);
  }
  if (["consent_required", "consent_policy_outdated"].includes(error.code)) {
    return new PublicBookingValidationError(["consent_required"]);
  }
  return error;
}

export function createHttpPublicBookingService(): PublicBookingService {
  return new HttpPublicBookingService();
}
