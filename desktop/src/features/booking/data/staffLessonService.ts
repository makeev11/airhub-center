import { z } from "zod";

import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;

const uuidSchema = z.string().uuid();
const lessonRefSchema = z.object({
  recurrenceRuleId: uuidSchema,
  originalDate: z.string().date(),
});
const attendanceStatusSchema = z.enum(["present", "absent"]);

const rosterEntrySchema = z.object({
  familyId: uuidSchema,
  familyName: z.string().min(1).max(200),
  representativeId: uuidSchema,
  representativeName: z.string().min(1).max(160),
  childId: uuidSchema,
  childName: z.string().min(1).max(160),
  bookingId: uuidSchema.nullable(),
  bookingStatus: z.enum(["pending_confirmation", "confirmed"]).nullable(),
  visitKind: z.enum(["trial", "single"]).nullable(),
  enrollmentId: uuidSchema.nullable(),
  attendanceId: uuidSchema.nullable(),
  attendanceStatus: attendanceStatusSchema.nullable(),
  attendanceVersion: z.number().int().nonnegative(),
  attendanceMarkedAt: z.string().datetime({ offset: true }).nullable(),
});

const rosterSchema = z.object({
  lessonRef: lessonRefSchema,
  trackAttendance: z.boolean(),
  items: z.array(rosterEntrySchema),
});

const participantOutcomeSchema = z.object({
  familyId: uuidSchema,
  representativeId: uuidSchema,
  childId: uuidSchema,
  bookingId: uuidSchema.nullable(),
  participantStatus: z.enum(["confirmed", "enrolled"]),
  visitKind: z.enum(["trial", "single"]).nullable(),
  replayed: z.boolean(),
});

const attendanceOutcomeSchema = z.object({
  childId: uuidSchema,
  attendanceId: uuidSchema.nullable(),
  status: attendanceStatusSchema.nullable(),
  version: z.number().int().nonnegative(),
  replayed: z.boolean(),
});

export type StaffLessonReference = z.infer<typeof lessonRefSchema>;
export type StaffLessonAttendanceStatus = z.infer<
  typeof attendanceStatusSchema
>;
export type StaffLessonRosterEntry = z.infer<typeof rosterEntrySchema>;
export type StaffLessonRoster = z.infer<typeof rosterSchema>;
export type StaffLessonParticipantOutcome = z.infer<
  typeof participantOutcomeSchema
>;
export type StaffLessonAttendanceOutcome = z.infer<
  typeof attendanceOutcomeSchema
>;

export type StaffLessonParticipantClient =
  | {
      mode: "existing";
      familyId: string;
      representativeId: string;
      childId: string;
    }
  | {
      mode: "new";
      parentName: string;
      phone: string;
      childName: string;
      childBirthDate: string;
    };

export interface StaffLessonService {
  getRoster(lessonRef: StaffLessonReference): Promise<StaffLessonRoster>;
  addParticipant(input: {
    lessonRef: StaffLessonReference;
    client: StaffLessonParticipantClient;
    visitKind: "trial" | "single";
    idempotencyKey?: string;
  }): Promise<StaffLessonParticipantOutcome>;
  setAttendance(input: {
    lessonRef: StaffLessonReference;
    childId: string;
    expectedVersion: number;
    status: StaffLessonAttendanceStatus | null;
    idempotencyKey?: string;
  }): Promise<StaffLessonAttendanceOutcome>;
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

type HttpStaffLessonServiceOptions = {
  relayHttpUrl?: () => Promise<string>;
  signEvent?: EventSigner;
  fetch?: FetchImplementation;
  idempotencyKeyFactory?: () => string;
};

export class StaffLessonApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StaffLessonApiError";
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
  method: "GET" | "POST" | "PUT",
  url: string,
  body: string | null,
  signEvent: EventSigner,
): Promise<string> {
  const tags = [
    ["u", url],
    ["method", method],
  ];
  if (body !== null) tags.push(["payload", await sha256Hex(body)]);
  tags.push(["nonce", crypto.randomUUID()]);
  const event = await signEvent({ kind: NIP98_KIND, content: "", tags });
  return `Nostr ${base64Utf8(JSON.stringify(event))}`;
}

function lessonPath(lessonRef: StaffLessonReference): string {
  const parsed = lessonRefSchema.safeParse(lessonRef);
  if (!parsed.success) {
    throw new StaffLessonApiError(400, "Invalid AirHub lesson reference.");
  }
  return `/api/airhop/staff/v1/lessons/${encodeURIComponent(parsed.data.recurrenceRuleId)}/${encodeURIComponent(parsed.data.originalDate)}/participants`;
}

/** NIP-98 client for the authoritative one-lesson roster and commands. */
export class HttpStaffLessonService implements StaffLessonService {
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;
  private readonly idempotencyKeyFactory: () => string;

  constructor(options: HttpStaffLessonServiceOptions = {}) {
    this.relayHttpUrl = options.relayHttpUrl ?? getRelayHttpUrl;
    this.signEvent = options.signEvent ?? signRelayEvent;
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
    this.idempotencyKeyFactory =
      options.idempotencyKeyFactory ?? (() => crypto.randomUUID());
  }

  async getRoster(lessonRef: StaffLessonReference): Promise<StaffLessonRoster> {
    return this.request(
      "GET",
      lessonPath(lessonRef),
      null,
      rosterSchema,
      undefined,
    );
  }

  async addParticipant(input: {
    lessonRef: StaffLessonReference;
    client: StaffLessonParticipantClient;
    visitKind: "trial" | "single";
    idempotencyKey?: string;
  }): Promise<StaffLessonParticipantOutcome> {
    const client = validateClient(input.client);
    if (input.visitKind !== "trial" && input.visitKind !== "single") {
      throw new StaffLessonApiError(400, "Invalid AirHub visit kind.");
    }
    return this.request(
      "POST",
      lessonPath(input.lessonRef),
      { client, visitKind: input.visitKind },
      participantOutcomeSchema,
      input.idempotencyKey,
    );
  }

  async setAttendance(input: {
    lessonRef: StaffLessonReference;
    childId: string;
    expectedVersion: number;
    status: StaffLessonAttendanceStatus | null;
    idempotencyKey?: string;
  }): Promise<StaffLessonAttendanceOutcome> {
    const childId = uuidSchema.safeParse(input.childId);
    if (
      !childId.success ||
      !Number.isInteger(input.expectedVersion) ||
      input.expectedVersion < 0 ||
      (input.status !== null &&
        !attendanceStatusSchema.safeParse(input.status).success)
    ) {
      throw new StaffLessonApiError(400, "Invalid AirHub attendance command.");
    }
    return this.request(
      "PUT",
      `${lessonPath(input.lessonRef)}/${encodeURIComponent(childId.data)}/attendance`,
      { expectedVersion: input.expectedVersion, status: input.status },
      attendanceOutcomeSchema,
      input.idempotencyKey,
    );
  }

  private async request<T>(
    method: "GET" | "POST" | "PUT",
    path: string,
    requestBody: unknown | null,
    schema: z.ZodType<T>,
    idempotencyKey: string | undefined,
  ): Promise<T> {
    const baseUrl = (await this.relayHttpUrl()).replace(/\/+$/, "");
    const url = `${baseUrl}${path}`;
    const body = requestBody === null ? null : JSON.stringify(requestBody);
    const requestAuthorization = await authorization(
      method,
      url,
      body,
      this.signEvent,
    );
    const headers: Record<string, string> = {
      Accept: "application/json",
      Authorization: requestAuthorization,
    };
    if (body !== null) {
      headers["Content-Type"] = "application/json";
      headers["Idempotency-Key"] =
        idempotencyKey ?? this.idempotencyKeyFactory();
    }
    const response = await this.fetchImplementation(url, {
      method,
      headers,
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
      throw new StaffLessonApiError(response.status, message);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffLessonApiError(
        502,
        "The AirHub lesson API returned invalid data.",
      );
    }
    return parsed.data;
  }
}

function validateClient(
  client: StaffLessonParticipantClient,
): StaffLessonParticipantClient {
  if (client.mode === "existing") {
    if (
      !uuidSchema.safeParse(client.familyId).success ||
      !uuidSchema.safeParse(client.representativeId).success ||
      !uuidSchema.safeParse(client.childId).success
    ) {
      throw new StaffLessonApiError(
        400,
        "Invalid AirHub participant identity.",
      );
    }
    return client;
  }
  if (
    !client.parentName.trim() ||
    client.parentName.trim().length > 160 ||
    !client.phone.trim() ||
    client.phone.trim().length > 80 ||
    !client.childName.trim() ||
    client.childName.trim().length > 160 ||
    !z.string().date().safeParse(client.childBirthDate).success
  ) {
    throw new StaffLessonApiError(400, "Invalid new AirHub participant.");
  }
  return {
    ...client,
    parentName: client.parentName.trim(),
    phone: client.phone.trim(),
    childName: client.childName.trim(),
  };
}

export function createHttpStaffLessonService(): StaffLessonService {
  return new HttpStaffLessonService();
}
