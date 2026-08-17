import { z } from "zod";

import {
  BookingRevisionConflictError,
  type BookingRepository,
} from "@/features/booking/data/bookingRepository";
import {
  organizationSchema,
  parseBookingWorkspace,
  tariffSchema,
  type BookingOrganization,
  type BookingTariff,
  type BookingWorkspace,
  type BookingWorkspaceDraft,
} from "@/features/booking/model/bookingCore";
import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;
const TARIFFS_PATH = "/api/airhop/staff/v1/tariffs";

const serverTariffSchema = tariffSchema
  .omit({ description: true, paymentDayOfMonth: true })
  .extend({
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    description: z.string().max(4_000).nullable().optional(),
    paymentDayOfMonth: z.number().int().min(1).max(28).nullable().optional(),
    activeEnrollmentCount: z.number().int().nonnegative(),
    version: z.number().int().positive(),
  });

const directoryResponseSchema = z.object({
  organization: organizationSchema,
  organizationVersion: z.number().int().positive(),
  items: z.array(serverTariffSchema),
});

const mutationResponseSchema = z.object({
  tariffId: z.string().uuid(),
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

type Options = {
  relayHttpUrl?: () => Promise<string>;
  signEvent?: EventSigner;
  fetch?: FetchImplementation;
  idempotencyKeyFactory?: () => string;
  nonceFactory?: () => string;
};

/** HTTP failure returned by the authoritative AirHub tariff endpoints. */
export class BookingTariffsApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BookingTariffsApiError";
    this.status = status;
  }
}

function emptyWorkspace(
  organization: BookingOrganization,
  tariffs: BookingTariff[],
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
    tariffs,
    enrollments: [],
    paymentExpectations: [],
    intakeRequests: [],
    pendingActions: [],
    attendanceRecords: [],
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

async function authorization(
  method: "GET" | "POST" | "PUT",
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

function sameTariff(first: BookingTariff, second: BookingTariff): boolean {
  return (
    first.name === second.name &&
    first.description === second.description &&
    first.priceMinor === second.priceMinor &&
    first.currency === second.currency &&
    first.weeklyScheduleLimit === second.weeklyScheduleLimit &&
    first.paymentDayOfMonth === second.paymentDayOfMonth &&
    first.status === second.status
  );
}

function tariffBody(tariff: BookingTariff, expectedVersion?: number) {
  return {
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    name: tariff.name,
    description: tariff.description ?? null,
    priceMinor: tariff.priceMinor,
    currency: tariff.currency,
    weeklyScheduleLimit: tariff.weeklyScheduleLimit,
    paymentDayOfMonth: tariff.paymentDayOfMonth ?? null,
    ...(expectedVersion === undefined ? {} : { status: tariff.status }),
  };
}

/** Server-backed tariff repository used by the production Tauri surface. */
export class HttpBookingTariffsRepository implements BookingRepository {
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;
  private readonly idempotencyKeyFactory: () => string;
  private readonly nonceFactory: () => string;
  private snapshot: BookingWorkspace | null = null;
  private tariffVersions = new Map<string, number>();

  constructor(options: Options = {}) {
    this.relayHttpUrl = options.relayHttpUrl ?? getRelayHttpUrl;
    this.signEvent = options.signEvent ?? signRelayEvent;
    this.fetchImplementation =
      options.fetch ?? globalThis.fetch.bind(globalThis);
    this.idempotencyKeyFactory =
      options.idempotencyKeyFactory ?? (() => crypto.randomUUID());
    this.nonceFactory = options.nonceFactory ?? (() => crypto.randomUUID());
  }

  async load(): Promise<BookingWorkspace> {
    return this.fetchDirectory();
  }

  async save(
    draft: BookingWorkspaceDraft,
    expectedRevision: number,
  ): Promise<BookingWorkspace> {
    const current = this.snapshot ?? (await this.fetchDirectory());
    if (current.revision !== expectedRevision) {
      throw new BookingRevisionConflictError(
        expectedRevision,
        current.revision,
      );
    }
    const nextTariffs = z.array(tariffSchema).parse(draft.tariffs);
    const currentById = new Map(
      current.tariffs.map((tariff) => [tariff.id, tariff]),
    );
    const nextById = new Map(nextTariffs.map((tariff) => [tariff.id, tariff]));
    if (current.tariffs.some((tariff) => !nextById.has(tariff.id))) {
      throw new BookingTariffsApiError(
        400,
        "Tariffs must be archived instead of removed.",
      );
    }
    const created = nextTariffs.filter((tariff) => !currentById.has(tariff.id));
    const changed = nextTariffs.filter((tariff) => {
      const previous = currentById.get(tariff.id);
      return previous !== undefined && !sameTariff(previous, tariff);
    });
    if (created.length + changed.length !== 1) {
      if (!created.length && !changed.length) return current;
      throw new BookingTariffsApiError(
        400,
        "Save one AirHub tariff at a time.",
      );
    }
    try {
      if (created.length === 1) {
        await this.mutate("POST", TARIFFS_PATH, tariffBody(created[0]));
      } else {
        const tariff = changed[0];
        const id = z.string().uuid().safeParse(tariff.id);
        const version = this.tariffVersions.get(tariff.id);
        if (!id.success || version === undefined) {
          throw new BookingTariffsApiError(
            400,
            "The AirHub tariff identity is not server-owned.",
          );
        }
        await this.mutate(
          "PUT",
          `${TARIFFS_PATH}/${encodeURIComponent(id.data)}`,
          tariffBody(tariff, version),
        );
      }
    } catch (error) {
      if (error instanceof BookingTariffsApiError && error.status === 409) {
        const latest = await this.fetchDirectory();
        throw new BookingRevisionConflictError(
          expectedRevision,
          latest.revision,
        );
      }
      throw error;
    }
    return this.fetchDirectory();
  }

  private async fetchDirectory(): Promise<BookingWorkspace> {
    const url = await this.url(TARIFFS_PATH);
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
    const parsed = directoryResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BookingTariffsApiError(
        502,
        "The AirHub tariff API returned invalid data.",
      );
    }
    this.tariffVersions = new Map(
      parsed.data.items.map((tariff) => [tariff.id, tariff.version]),
    );
    const tariffs = parsed.data.items.map(
      ({ version: _version, description, paymentDayOfMonth, ...tariff }) =>
        tariffSchema.parse({
          ...tariff,
          ...(description ? { description } : {}),
          ...(paymentDayOfMonth ? { paymentDayOfMonth } : {}),
        }),
    );
    const revision =
      parsed.data.organizationVersion +
      parsed.data.items.reduce((total, tariff) => total + tariff.version, 0);
    this.snapshot = emptyWorkspace(parsed.data.organization, tariffs, revision);
    return this.snapshot;
  }

  private async mutate(
    method: "POST" | "PUT",
    path: string,
    requestBody: unknown,
  ): Promise<void> {
    const url = await this.url(path);
    const body = JSON.stringify(requestBody);
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
    if (!mutationResponseSchema.safeParse(payload).success) {
      throw new BookingTariffsApiError(
        502,
        "The AirHub tariff command returned invalid data.",
      );
    }
  }

  private async url(path: string): Promise<string> {
    return `${(await this.relayHttpUrl()).replace(/\/+$/, "")}${path}`;
  }

  private apiError(
    response: Response,
    payload: unknown,
  ): BookingTariffsApiError {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `HTTP ${response.status}`;
    return new BookingTariffsApiError(response.status, message);
  }
}

export function createHttpBookingTariffsRepository(): BookingRepository {
  return new HttpBookingTariffsRepository();
}
