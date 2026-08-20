import { z } from "zod";

import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;
const uuidSchema = z.string().uuid();
const statusSchema = z.enum(["active", "archived"]);

const createOutcomeSchema = z.object({
  familyId: uuidSchema,
  representativeId: uuidSchema,
  childId: uuidSchema,
  hasPendingDuplicate: z.boolean(),
  replayed: z.boolean(),
});
const statusOutcomeSchema = z.object({
  familyId: uuidSchema,
  status: statusSchema,
  version: z.number().int().positive(),
  replayed: z.boolean(),
});

export type CreateStaffFamilyInput = {
  displayName: string;
  representativeName: string;
  representativeFirstName: string;
  representativeLastName: string;
  phone: string;
  preferredContactChannel?: "telegram" | "max" | "whatsapp" | "phone" | "none";
  childName: string;
  childFirstName: string;
  childLastName: string;
  childBirthDate: string;
  childNote?: string | null;
  idempotencyKey?: string;
};

export type SetStaffFamilyStatusInput = {
  familyId: string;
  expectedVersion: number;
  status: "active" | "archived";
  idempotencyKey?: string;
};

export type CreateStaffFamilyOutcome = z.infer<typeof createOutcomeSchema>;
export type SetStaffFamilyStatusOutcome = z.infer<typeof statusOutcomeSchema>;

export interface StaffFamilyLifecycleService {
  createFamily(
    input: CreateStaffFamilyInput,
  ): Promise<CreateStaffFamilyOutcome>;
  setFamilyStatus(
    input: SetStaffFamilyStatusInput,
  ): Promise<SetStaffFamilyStatusOutcome>;
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

export class StaffFamilyLifecycleApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "StaffFamilyLifecycleApiError";
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
  method: "POST" | "PUT",
  url: string,
  body: string,
  signEvent: EventSigner,
): Promise<string> {
  const event = await signEvent({
    kind: NIP98_KIND,
    content: "",
    tags: [
      ["u", url],
      ["method", method],
      ["payload", await sha256Hex(body)],
      ["nonce", crypto.randomUUID()],
    ],
  });
  return `Nostr ${base64Utf8(JSON.stringify(event))}`;
}

/** NIP-98 client for atomic family creation and explicit lifecycle changes. */
export class HttpStaffFamilyLifecycleService
  implements StaffFamilyLifecycleService
{
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

  async createFamily(
    input: CreateStaffFamilyInput,
  ): Promise<CreateStaffFamilyOutcome> {
    const date = z.string().date().safeParse(input.childBirthDate);
    if (
      !bounded(input.displayName, 200) ||
      !bounded(input.representativeName, 160) ||
      !bounded(input.representativeFirstName, 80) ||
      !bounded(input.representativeLastName, 80) ||
      !bounded(input.phone, 80) ||
      !bounded(input.childName, 160) ||
      !bounded(input.childFirstName, 80) ||
      !bounded(input.childLastName, 80) ||
      !date.success ||
      (input.childNote?.trim().length ?? 0) > 4_000
    ) {
      throw new StaffFamilyLifecycleApiError(
        400,
        "Invalid AirHub family creation.",
      );
    }
    return this.request(
      "POST",
      "/api/airhop/staff/v1/families",
      {
        displayName: input.displayName.trim(),
        representativeName: input.representativeName.trim(),
        representativeFirstName: input.representativeFirstName.trim(),
        representativeLastName: input.representativeLastName.trim(),
        phone: input.phone.trim(),
        preferredContactChannel: input.preferredContactChannel ?? "phone",
        childName: input.childName.trim(),
        childFirstName: input.childFirstName.trim(),
        childLastName: input.childLastName.trim(),
        childBirthDate: date.data,
        childNote: input.childNote?.trim() || null,
      },
      createOutcomeSchema,
      input.idempotencyKey,
    );
  }

  async setFamilyStatus(
    input: SetStaffFamilyStatusInput,
  ): Promise<SetStaffFamilyStatusOutcome> {
    const familyId = uuidSchema.safeParse(input.familyId);
    const status = statusSchema.safeParse(input.status);
    if (
      !familyId.success ||
      !status.success ||
      !validVersion(input.expectedVersion)
    ) {
      throw new StaffFamilyLifecycleApiError(
        400,
        "Invalid AirHub family status.",
      );
    }
    return this.request(
      "PUT",
      `/api/airhop/staff/v1/families/${encodeURIComponent(familyId.data)}/status`,
      { expectedVersion: input.expectedVersion, status: status.data },
      statusOutcomeSchema,
      input.idempotencyKey,
    );
  }

  private async request<T>(
    method: "POST" | "PUT",
    path: string,
    requestBody: unknown,
    schema: z.ZodType<T>,
    idempotencyKey?: string,
  ): Promise<T> {
    const url = `${(await this.relayHttpUrl()).replace(/\/+$/, "")}${path}`;
    const body = JSON.stringify(requestBody);
    const response = await this.fetchImplementation(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: await authorization(method, url, body, this.signEvent),
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey ?? this.idempotencyKeyFactory(),
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
      throw new StaffFamilyLifecycleApiError(response.status, message);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffFamilyLifecycleApiError(
        502,
        "The AirHub family lifecycle API returned invalid data.",
      );
    }
    return parsed.data;
  }
}

function bounded(value: string, max: number): boolean {
  const trimmed = value.trim();
  return trimmed.length > 0 && trimmed.length <= max;
}

function validVersion(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

export function createHttpStaffFamilyLifecycleService(): StaffFamilyLifecycleService {
  return new HttpStaffFamilyLifecycleService();
}
