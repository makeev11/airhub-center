import { z } from "zod";

import {
  BookingRevisionConflictError,
  type BookingRepository,
} from "@/features/booking/data/bookingRepository";
import {
  bookingIdSchema,
  branchSchema,
  organizationSchema,
  parseBookingWorkspace,
  type BookingBranch,
  type BookingOrganization,
  type BookingWorkspace,
  type BookingWorkspaceDraft,
} from "@/features/booking/model/bookingCore";
import { getRelayHttpUrl, signRelayEvent } from "@/shared/api/tauri";
import type { RelayEvent } from "@/shared/api/types";

const NIP98_KIND = 27235;
const REQUEST_TIMEOUT_MS = 15_000;
const BRANCHES_PATH = "/api/airhop/staff/v1/branches";

const serverBranchSchema = branchSchema
  .omit({ defaultBuzzChannelId: true })
  .extend({
    defaultBuzzChannelId: bookingIdSchema.nullable().optional(),
    version: z.number().int().positive(),
  });
const directoryResponseSchema = z.object({
  organization: organizationSchema,
  organizationVersion: z.number().int().positive(),
  items: z.array(serverBranchSchema),
});
const mutationResponseSchema = z.object({
  branchId: z.string().uuid(),
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

/** HTTP failure returned by the authoritative AirHub branch endpoints. */
export class BookingBranchesApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "BookingBranchesApiError";
    this.status = status;
  }
}

function emptyWorkspace(
  organization: BookingOrganization,
  branches: BookingBranch[],
  revision: number,
): BookingWorkspace {
  return parseBookingWorkspace({
    schemaVersion: 8,
    revision,
    organization,
    branches,
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

function branchBody(branch: BookingBranch, expectedVersion?: number) {
  return {
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    name: branch.name,
    address: branch.address,
    workingHours: branch.workingHours,
    defaultBuzzChannelId: branch.defaultBuzzChannelId ?? null,
    ...(expectedVersion === undefined ? {} : { status: branch.status }),
  };
}

function sameBranch(first: BookingBranch, second: BookingBranch): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

/** Server-backed repository used only by the branches surface in Tauri. */
export class HttpBookingBranchesRepository implements BookingRepository {
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;
  private readonly idempotencyKeyFactory: () => string;
  private readonly nonceFactory: () => string;
  private snapshot: BookingWorkspace | null = null;
  private branchVersions = new Map<string, number>();

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
    const nextBranches = z.array(branchSchema).parse(draft.branches);
    const currentById = new Map(
      current.branches.map((branch) => [branch.id, branch]),
    );
    const nextById = new Map(nextBranches.map((branch) => [branch.id, branch]));
    if (current.branches.some((branch) => !nextById.has(branch.id))) {
      throw new BookingBranchesApiError(
        400,
        "Branches must be archived instead of removed.",
      );
    }
    const created = nextBranches.filter(
      (branch) => !currentById.has(branch.id),
    );
    const changed = nextBranches.filter((branch) => {
      const previous = currentById.get(branch.id);
      return previous !== undefined && !sameBranch(previous, branch);
    });
    if (created.length + changed.length !== 1) {
      if (created.length + changed.length === 0) return current;
      throw new BookingBranchesApiError(
        400,
        "Save one AirHub branch at a time.",
      );
    }
    try {
      if (created.length === 1) {
        if (created[0].status !== "active") {
          throw new BookingBranchesApiError(
            400,
            "A new AirHub branch must be active.",
          );
        }
        await this.mutate("POST", BRANCHES_PATH, branchBody(created[0]));
      } else {
        const branch = changed[0];
        const version = this.branchVersions.get(branch.id);
        const branchId = z.string().uuid().safeParse(branch.id);
        if (!branchId.success || version === undefined) {
          throw new BookingBranchesApiError(
            400,
            "The AirHub branch identity is not server-owned.",
          );
        }
        await this.mutate(
          "PUT",
          `${BRANCHES_PATH}/${encodeURIComponent(branchId.data)}`,
          branchBody(branch, version),
        );
      }
      return await this.fetchDirectory();
    } catch (error) {
      if (error instanceof BookingBranchesApiError && error.status === 409) {
        const latest = await this.fetchDirectory();
        throw new BookingRevisionConflictError(
          expectedRevision,
          latest.revision,
        );
      }
      throw error;
    }
  }

  private async fetchDirectory(): Promise<BookingWorkspace> {
    const path = BRANCHES_PATH;
    const url = await this.url(path);
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
    if (!response.ok) throw await this.apiError(response, payload);
    const parsed = directoryResponseSchema.safeParse(payload);
    if (!parsed.success) {
      throw new BookingBranchesApiError(
        502,
        "The AirHub branches API returned invalid data.",
      );
    }
    this.branchVersions = new Map(
      parsed.data.items.map((branch) => [branch.id, branch.version]),
    );
    const branches = parsed.data.items.map(
      ({ version: _version, defaultBuzzChannelId, ...branch }) =>
        branchSchema.parse({
          ...branch,
          ...(defaultBuzzChannelId ? { defaultBuzzChannelId } : {}),
        }),
    );
    const revision =
      parsed.data.organizationVersion +
      parsed.data.items.reduce((total, branch) => total + branch.version, 0);
    this.snapshot = emptyWorkspace(
      parsed.data.organization,
      branches,
      revision,
    );
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
    if (!response.ok) throw await this.apiError(response, payload);
    if (!mutationResponseSchema.safeParse(payload).success) {
      throw new BookingBranchesApiError(
        502,
        "The AirHub branch command returned invalid data.",
      );
    }
  }

  private async url(path: string): Promise<string> {
    return `${(await this.relayHttpUrl()).replace(/\/+$/, "")}${path}`;
  }

  private async apiError(
    response: Response,
    payload: unknown,
  ): Promise<BookingBranchesApiError> {
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : `HTTP ${response.status}`;
    return new BookingBranchesApiError(response.status, message);
  }
}

export function createHttpBookingBranchesRepository(): BookingRepository {
  return new HttpBookingBranchesRepository();
}
