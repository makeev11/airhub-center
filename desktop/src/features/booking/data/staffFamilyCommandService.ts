import { z } from "zod";

import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;

const uuidSchema = z.string().uuid();
const contactChannelSchema = z.enum([
  "telegram",
  "max",
  "whatsapp",
  "phone",
  "none",
]);

const representativeUpdateOutcomeSchema = z.object({
  representativeId: uuidSchema,
  version: z.number().int().positive(),
  hasPendingDuplicate: z.boolean(),
  replayed: z.boolean(),
});
const familyUpdateOutcomeSchema = z.object({
  familyId: uuidSchema,
  version: z.number().int().positive(),
  replayed: z.boolean(),
});
const childUpdateOutcomeSchema = z.object({
  childId: uuidSchema,
  version: z.number().int().positive(),
  replayed: z.boolean(),
});
const representativeCreateOutcomeSchema = z.object({
  representativeId: uuidSchema,
  hasPendingDuplicate: z.boolean(),
  replayed: z.boolean(),
});
const childCreateOutcomeSchema = z.object({
  childId: uuidSchema,
  hasPendingDuplicate: z.boolean(),
  replayed: z.boolean(),
});
const representativeStatusOutcomeSchema = z.object({
  representativeId: uuidSchema,
  status: z.enum(["active", "archived"]),
  version: z.number().int().positive(),
  hasPendingDuplicate: z.boolean(),
  replayed: z.boolean(),
});
const childStatusOutcomeSchema = z.object({
  childId: uuidSchema,
  status: z.enum(["active", "archived"]),
  version: z.number().int().positive(),
  hasPendingDuplicate: z.boolean(),
  replayed: z.boolean(),
});

export type StaffRepresentativeContactChannel = z.infer<
  typeof contactChannelSchema
>;
export type StaffRepresentativeUpdateOutcome = z.infer<
  typeof representativeUpdateOutcomeSchema
>;
export type StaffFamilyUpdateOutcome = z.infer<
  typeof familyUpdateOutcomeSchema
>;
export type StaffChildUpdateOutcome = z.infer<typeof childUpdateOutcomeSchema>;
export type StaffRepresentativeCreateOutcome = z.infer<
  typeof representativeCreateOutcomeSchema
>;
export type StaffChildCreateOutcome = z.infer<typeof childCreateOutcomeSchema>;
export type StaffRepresentativeStatusOutcome = z.infer<
  typeof representativeStatusOutcomeSchema
>;
export type StaffChildStatusOutcome = z.infer<typeof childStatusOutcomeSchema>;

export type SetStaffFamilyRepresentativeStatusInput = {
  familyId: string;
  representativeId: string;
  expectedVersion: number;
  status: "active" | "archived";
  idempotencyKey?: string;
};

export type SetStaffFamilyChildStatusInput = {
  familyId: string;
  childId: string;
  expectedVersion: number;
  status: "active" | "archived";
  idempotencyKey?: string;
};

export type AddStaffFamilyRepresentativeInput = {
  familyId: string;
  displayName: string;
  phone: string;
  preferredContactChannel: StaffRepresentativeContactChannel;
  idempotencyKey?: string;
};

export type AddStaffFamilyChildInput = {
  familyId: string;
  displayName: string;
  birthDate: string;
  note: string | null;
  idempotencyKey?: string;
};

export type UpdateStaffFamilyInput = {
  familyId: string;
  expectedVersion: number;
  displayName: string;
  idempotencyKey?: string;
};

export type UpdateStaffFamilyChildInput = {
  familyId: string;
  childId: string;
  expectedVersion: number;
  displayName: string;
  birthDate: string;
  note: string | null;
  idempotencyKey?: string;
};

export type UpdateStaffFamilyRepresentativeInput = {
  familyId: string;
  representativeId: string;
  expectedVersion: number;
  displayName: string;
  phone: string;
  preferredContactChannel: StaffRepresentativeContactChannel;
  idempotencyKey?: string;
};

export interface StaffFamilyCommandService {
  addChild(input: AddStaffFamilyChildInput): Promise<StaffChildCreateOutcome>;
  addRepresentative(
    input: AddStaffFamilyRepresentativeInput,
  ): Promise<StaffRepresentativeCreateOutcome>;
  setChildStatus(
    input: SetStaffFamilyChildStatusInput,
  ): Promise<StaffChildStatusOutcome>;
  setRepresentativeStatus(
    input: SetStaffFamilyRepresentativeStatusInput,
  ): Promise<StaffRepresentativeStatusOutcome>;
  updateFamily(
    input: UpdateStaffFamilyInput,
  ): Promise<StaffFamilyUpdateOutcome>;
  updateChild(
    input: UpdateStaffFamilyChildInput,
  ): Promise<StaffChildUpdateOutcome>;
  updateRepresentative(
    input: UpdateStaffFamilyRepresentativeInput,
  ): Promise<StaffRepresentativeUpdateOutcome>;
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

type HttpStaffFamilyCommandServiceOptions = {
  relayHttpUrl?: () => Promise<string>;
  signEvent?: EventSigner;
  fetch?: FetchImplementation;
  idempotencyKeyFactory?: () => string;
};

export class StaffFamilyCommandApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "StaffFamilyCommandApiError";
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

async function nip98Authorization(
  method: "POST" | "PUT",
  url: string,
  body: string,
  nonce: string,
  signEvent: EventSigner,
): Promise<string> {
  const event = await signEvent({
    kind: NIP98_KIND,
    content: "",
    tags: [
      ["u", url],
      ["method", method],
      ["payload", await sha256Hex(body)],
      ["nonce", nonce],
    ],
  });
  return `Nostr ${base64Utf8(JSON.stringify(event))}`;
}

/** NIP-98 client for idempotent, audited family staff commands. */
export class HttpStaffFamilyCommandService
  implements StaffFamilyCommandService
{
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;
  private readonly idempotencyKeyFactory: () => string;

  constructor(options: HttpStaffFamilyCommandServiceOptions = {}) {
    this.relayHttpUrl = options.relayHttpUrl ?? getRelayHttpUrl;
    this.signEvent = options.signEvent ?? signRelayEvent;
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
    this.idempotencyKeyFactory =
      options.idempotencyKeyFactory ?? (() => crypto.randomUUID());
  }

  async addChild(
    input: AddStaffFamilyChildInput,
  ): Promise<StaffChildCreateOutcome> {
    const familyId = uuidSchema.safeParse(input.familyId);
    const birthDate = z.string().date().safeParse(input.birthDate);
    const displayName = input.displayName.trim();
    const note = input.note?.trim() || null;
    if (
      !familyId.success ||
      !birthDate.success ||
      !displayName ||
      displayName.length > 160 ||
      (note?.length ?? 0) > 4_000
    ) {
      throw new StaffFamilyCommandApiError(
        400,
        "Invalid AirHub child creation.",
      );
    }
    return this.request(
      "POST",
      `/api/airhop/staff/v1/families/${encodeURIComponent(familyId.data)}/children`,
      { displayName, birthDate: birthDate.data, note },
      childCreateOutcomeSchema,
      input.idempotencyKey,
    );
  }

  async addRepresentative(
    input: AddStaffFamilyRepresentativeInput,
  ): Promise<StaffRepresentativeCreateOutcome> {
    const familyId = uuidSchema.safeParse(input.familyId);
    const channel = contactChannelSchema.safeParse(
      input.preferredContactChannel,
    );
    if (
      !familyId.success ||
      !channel.success ||
      !input.displayName.trim() ||
      input.displayName.trim().length > 160 ||
      !input.phone.trim() ||
      input.phone.trim().length > 80
    ) {
      throw new StaffFamilyCommandApiError(
        400,
        "Invalid AirHub representative creation.",
      );
    }
    return this.request(
      "POST",
      `/api/airhop/staff/v1/families/${encodeURIComponent(familyId.data)}/representatives`,
      {
        displayName: input.displayName.trim(),
        phone: input.phone.trim(),
        preferredContactChannel: channel.data,
      },
      representativeCreateOutcomeSchema,
      input.idempotencyKey,
    );
  }

  async setChildStatus(
    input: SetStaffFamilyChildStatusInput,
  ): Promise<StaffChildStatusOutcome> {
    const familyId = uuidSchema.safeParse(input.familyId);
    const childId = uuidSchema.safeParse(input.childId);
    if (
      !familyId.success ||
      !childId.success ||
      !validVersion(input.expectedVersion) ||
      !validStatus(input.status)
    ) {
      throw new StaffFamilyCommandApiError(
        400,
        "Invalid AirHub child lifecycle command.",
      );
    }
    return this.request(
      "PUT",
      `/api/airhop/staff/v1/families/${encodeURIComponent(familyId.data)}/children/${encodeURIComponent(childId.data)}/status`,
      { expectedVersion: input.expectedVersion, status: input.status },
      childStatusOutcomeSchema,
      input.idempotencyKey,
    );
  }

  async setRepresentativeStatus(
    input: SetStaffFamilyRepresentativeStatusInput,
  ): Promise<StaffRepresentativeStatusOutcome> {
    const familyId = uuidSchema.safeParse(input.familyId);
    const representativeId = uuidSchema.safeParse(input.representativeId);
    if (
      !familyId.success ||
      !representativeId.success ||
      !validVersion(input.expectedVersion) ||
      !validStatus(input.status)
    ) {
      throw new StaffFamilyCommandApiError(
        400,
        "Invalid AirHub representative lifecycle command.",
      );
    }
    return this.request(
      "PUT",
      `/api/airhop/staff/v1/families/${encodeURIComponent(familyId.data)}/representatives/${encodeURIComponent(representativeId.data)}/status`,
      { expectedVersion: input.expectedVersion, status: input.status },
      representativeStatusOutcomeSchema,
      input.idempotencyKey,
    );
  }

  async updateFamily(
    input: UpdateStaffFamilyInput,
  ): Promise<StaffFamilyUpdateOutcome> {
    const familyId = uuidSchema.safeParse(input.familyId);
    const displayName = input.displayName.trim();
    if (
      !familyId.success ||
      !validVersion(input.expectedVersion) ||
      !displayName ||
      displayName.length > 200
    ) {
      throw invalidUpdate("family");
    }
    return this.request(
      "PUT",
      `/api/airhop/staff/v1/families/${encodeURIComponent(familyId.data)}`,
      { expectedVersion: input.expectedVersion, displayName },
      familyUpdateOutcomeSchema,
      input.idempotencyKey,
    );
  }

  async updateChild(
    input: UpdateStaffFamilyChildInput,
  ): Promise<StaffChildUpdateOutcome> {
    const familyId = uuidSchema.safeParse(input.familyId);
    const childId = uuidSchema.safeParse(input.childId);
    const birthDate = z.string().date().safeParse(input.birthDate);
    const displayName = input.displayName.trim();
    const note = input.note?.trim() || null;
    if (
      !familyId.success ||
      !childId.success ||
      !birthDate.success ||
      !validVersion(input.expectedVersion) ||
      !displayName ||
      displayName.length > 160 ||
      (note?.length ?? 0) > 4_000
    ) {
      throw invalidUpdate("child");
    }
    return this.request(
      "PUT",
      `/api/airhop/staff/v1/families/${encodeURIComponent(familyId.data)}/children/${encodeURIComponent(childId.data)}`,
      {
        expectedVersion: input.expectedVersion,
        displayName,
        birthDate: birthDate.data,
        note,
      },
      childUpdateOutcomeSchema,
      input.idempotencyKey,
    );
  }

  async updateRepresentative(
    input: UpdateStaffFamilyRepresentativeInput,
  ): Promise<StaffRepresentativeUpdateOutcome> {
    const familyId = uuidSchema.safeParse(input.familyId);
    const representativeId = uuidSchema.safeParse(input.representativeId);
    const channel = contactChannelSchema.safeParse(
      input.preferredContactChannel,
    );
    if (
      !familyId.success ||
      !representativeId.success ||
      !channel.success ||
      !validVersion(input.expectedVersion) ||
      !input.displayName.trim() ||
      input.displayName.trim().length > 160 ||
      !input.phone.trim() ||
      input.phone.trim().length > 80
    ) {
      throw new StaffFamilyCommandApiError(
        400,
        "Invalid AirHub representative update.",
      );
    }
    return this.request(
      "PUT",
      `/api/airhop/staff/v1/families/${encodeURIComponent(familyId.data)}/representatives/${encodeURIComponent(representativeId.data)}`,
      {
        expectedVersion: input.expectedVersion,
        displayName: input.displayName.trim(),
        phone: input.phone.trim(),
        preferredContactChannel: channel.data,
      },
      representativeUpdateOutcomeSchema,
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
    const baseUrl = (await this.relayHttpUrl()).replace(/\/+$/, "");
    const url = `${baseUrl}${path}`;
    const body = JSON.stringify(requestBody);
    const authorization = await nip98Authorization(
      method,
      url,
      body,
      crypto.randomUUID(),
      this.signEvent,
    );
    const response = await this.fetchImplementation(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: authorization,
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
      throw new StaffFamilyCommandApiError(response.status, message);
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new StaffFamilyCommandApiError(
        502,
        "The AirHub family command API returned invalid data.",
      );
    }
    return parsed.data;
  }
}

function validVersion(value: number): boolean {
  return Number.isInteger(value) && value > 0;
}

function validStatus(value: string): value is "active" | "archived" {
  return value === "active" || value === "archived";
}

function invalidUpdate(entity: string): StaffFamilyCommandApiError {
  return new StaffFamilyCommandApiError(
    400,
    `Invalid AirHub ${entity} update.`,
  );
}

export function createHttpStaffFamilyCommandService(): StaffFamilyCommandService {
  return new HttpStaffFamilyCommandService();
}
