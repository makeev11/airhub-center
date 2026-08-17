import { z } from "zod";

import {
  BookingRevisionConflictError,
  type BookingRepository,
} from "@/features/booking/data/bookingRepository";
import {
  branchSchema,
  organizationSchema,
  parseBookingWorkspace,
  roomSchema,
  type BookingBranch,
  type BookingOrganization,
  type BookingRoom,
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
    id: z.string().uuid(),
    organizationId: z.string().uuid(),
    defaultBuzzChannelId: z.string().uuid().nullable().optional(),
    version: z.number().int().positive(),
  });
const serverRoomSchema = roomSchema.extend({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  branchId: z.string().uuid(),
  version: z.number().int().positive(),
});
const directoryResponseSchema = z.object({
  organization: organizationSchema,
  organizationVersion: z.number().int().positive(),
  items: z.array(serverBranchSchema),
  rooms: z.array(serverRoomSchema),
});
const mutationResponseSchema = z
  .object({
    version: z.number().int().positive(),
    replayed: z.boolean(),
  })
  .and(
    z.union([
      z.object({ branchId: z.string().uuid() }),
      z.object({ roomId: z.string().uuid() }),
    ]),
  );

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
  rooms: BookingRoom[],
  revision: number,
): BookingWorkspace {
  return parseBookingWorkspace({
    schemaVersion: 8,
    revision,
    organization,
    branches,
    rooms,
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

function roomBody(room: BookingRoom, expectedVersion?: number) {
  return {
    ...(expectedVersion === undefined ? {} : { expectedVersion }),
    name: room.name,
    ...(expectedVersion === undefined ? {} : { status: room.status }),
  };
}

function sameRoom(first: BookingRoom, second: BookingRoom): boolean {
  return JSON.stringify(first) === JSON.stringify(second);
}

/** Server-backed branch and room repository used by the Tauri settings surface. */
export class HttpBookingBranchesRepository implements BookingRepository {
  private readonly relayHttpUrl: () => Promise<string>;
  private readonly signEvent: EventSigner;
  private readonly fetchImplementation: FetchImplementation;
  private readonly idempotencyKeyFactory: () => string;
  private readonly nonceFactory: () => string;
  private snapshot: BookingWorkspace | null = null;
  private branchVersions = new Map<string, number>();
  private roomVersions = new Map<string, number>();

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
    const nextRooms = z.array(roomSchema).parse(draft.rooms);
    const currentById = new Map(
      current.branches.map((branch) => [branch.id, branch]),
    );
    const nextById = new Map(nextBranches.map((branch) => [branch.id, branch]));
    const currentRoomsById = new Map(
      current.rooms.map((room) => [room.id, room]),
    );
    const nextRoomsById = new Map(nextRooms.map((room) => [room.id, room]));
    if (current.branches.some((branch) => !nextById.has(branch.id))) {
      throw new BookingBranchesApiError(
        400,
        "Branches must be archived instead of removed.",
      );
    }
    if (current.rooms.some((room) => !nextRoomsById.has(room.id))) {
      throw new BookingBranchesApiError(
        400,
        "Rooms must be archived instead of removed.",
      );
    }
    const createdBranches = nextBranches.filter(
      (branch) => !currentById.has(branch.id),
    );
    const changedBranches = nextBranches.filter((branch) => {
      const previous = currentById.get(branch.id);
      return previous !== undefined && !sameBranch(previous, branch);
    });
    const createdRooms = nextRooms.filter(
      (room) => !currentRoomsById.has(room.id),
    );
    const changedRooms = nextRooms.filter((room) => {
      const previous = currentRoomsById.get(room.id);
      return previous !== undefined && !sameRoom(previous, room);
    });
    const mutationCount =
      createdBranches.length +
      changedBranches.length +
      createdRooms.length +
      changedRooms.length;
    if (mutationCount !== 1) {
      if (mutationCount === 0) return current;
      throw new BookingBranchesApiError(
        400,
        "Save one AirHub branch or room at a time.",
      );
    }
    try {
      if (createdBranches.length === 1) {
        if (createdBranches[0].status !== "active") {
          throw new BookingBranchesApiError(
            400,
            "A new AirHub branch must be active.",
          );
        }
        await this.mutate(
          "POST",
          BRANCHES_PATH,
          branchBody(createdBranches[0]),
        );
      } else if (changedBranches.length === 1) {
        const branch = changedBranches[0];
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
      } else if (createdRooms.length === 1) {
        const room = createdRooms[0];
        const branch = currentById.get(room.branchId);
        const branchId = z.string().uuid().safeParse(room.branchId);
        if (
          room.status !== "active" ||
          branch?.status !== "active" ||
          !branchId.success
        ) {
          throw new BookingBranchesApiError(
            400,
            "A new AirHub room requires an active server-owned branch.",
          );
        }
        await this.mutate(
          "POST",
          `${BRANCHES_PATH}/${encodeURIComponent(branchId.data)}/rooms`,
          roomBody(room),
        );
      } else {
        const room = changedRooms[0];
        const previous = currentRoomsById.get(room.id);
        const version = this.roomVersions.get(room.id);
        const branchId = z.string().uuid().safeParse(room.branchId);
        const roomId = z.string().uuid().safeParse(room.id);
        if (
          previous?.branchId !== room.branchId ||
          !branchId.success ||
          !roomId.success ||
          version === undefined
        ) {
          throw new BookingBranchesApiError(
            400,
            "The AirHub room identity or branch is not server-owned.",
          );
        }
        await this.mutate(
          "PUT",
          `${BRANCHES_PATH}/${encodeURIComponent(branchId.data)}/rooms/${encodeURIComponent(roomId.data)}`,
          roomBody(room, version),
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
    this.roomVersions = new Map(
      parsed.data.rooms.map((room) => [room.id, room.version]),
    );
    const branches = parsed.data.items.map(
      ({ version: _version, defaultBuzzChannelId, ...branch }) =>
        branchSchema.parse({
          ...branch,
          ...(defaultBuzzChannelId ? { defaultBuzzChannelId } : {}),
        }),
    );
    const rooms = parsed.data.rooms.map(({ version: _version, ...room }) =>
      roomSchema.parse(room),
    );
    const revision =
      parsed.data.organizationVersion +
      parsed.data.items.reduce((total, branch) => total + branch.version, 0) +
      parsed.data.rooms.reduce((total, room) => total + room.version, 0);
    this.snapshot = emptyWorkspace(
      parsed.data.organization,
      branches,
      rooms,
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
