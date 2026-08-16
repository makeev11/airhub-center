import {
  BookingRevisionConflictError,
  type BookingRepository,
} from "@/features/booking/data/bookingRepository";
import {
  findPublicBookingOccurrences,
  resolveStablePublicOccurrence,
  type PublicBookingOccurrence,
  type PublicOccurrenceSearchFilters,
} from "@/features/booking/lib/publicBookingAvailability";
import { organizationLocalDateTime } from "@/features/booking/lib/bookingDateTime";
import {
  digestPublicBookingCredential,
  generatePublicBookingToken,
} from "@/features/booking/lib/publicBookingSecurity";
import type {
  BookingWorkspace,
  PreferredContactChannel,
  PublicBookingAppearance,
  PublicBookingPurpose,
  PublicLessonBooking,
  StableLessonReference,
  TrialPolicy,
} from "@/features/booking/model/bookingCore";
import {
  isExactBirthDateEligible,
  maskPublicBookingPhone,
  normalizePublicBookingPhone,
  PUBLIC_BOOKING_CONSENT_VERSION,
  stableLessonReferenceKey,
  transitionBookingStatus,
  validatePublicApplicantDraft,
  type PublicApplicantDraft,
  type PublicApplicantValidationIssue,
} from "@/features/booking/model/publicBooking";
import { resolveBookingApplicantIdentity } from "@/features/booking/model/bookingClientIdentity";

const MAX_REVISION_RETRIES = 5;
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{22,200}$/;

export type PublicBookingCatalog = {
  organization: {
    id: string;
    name: string;
    locale: string;
    timeZone: string;
    currentDate: string;
    publicBooking: {
      purpose: PublicBookingPurpose;
      appearance: PublicBookingAppearance;
    };
  };
  branches: Array<{
    id: string;
    name: string;
    address: string;
  }>;
};

export type PublicBookingManagementCard = {
  status: PublicLessonBooking["status"];
  childName: string;
  maskedPhone: string;
  preferredContactChannel: PreferredContactChannel;
  transferRequest: PublicLessonBooking["transferRequest"];
  organizationName: string;
  branchName: string;
  branchAddress: string;
  groupName: string;
  roomName?: string;
  teacherNames: string[];
  date: string;
  startTime: string;
  endTime: string;
  trialPolicy: TrialPolicy;
  purpose: PublicBookingPurpose;
  canCancel: boolean;
  canRequestTransfer: boolean;
};

export type CreatePublicBookingCommand = {
  lessonRef: StableLessonReference;
  applicant: PublicApplicantDraft;
  preferredContactChannel?: PreferredContactChannel;
  idempotencyKey: string;
  purpose: PublicBookingPurpose;
  source: {
    surface: "standalone" | "embedded";
    attributionBranchId?: string;
  };
};

export type CreatePublicBookingResult = {
  managementToken: string | null;
  card: PublicBookingManagementCard;
};

export interface PublicBookingService {
  getCatalog(): Promise<PublicBookingCatalog>;
  findOccurrences(
    filters: PublicOccurrenceSearchFilters,
  ): Promise<PublicBookingOccurrence[]>;
  createBooking(
    command: CreatePublicBookingCommand,
  ): Promise<CreatePublicBookingResult>;
  getManagementCard(
    managementToken: string,
  ): Promise<PublicBookingManagementCard | null>;
  cancelByParent(
    managementToken: string,
  ): Promise<PublicBookingManagementCard | null>;
  requestTransfer(
    managementToken: string,
    comment?: string,
  ): Promise<PublicBookingManagementCard | null>;
  setPreferredContactChannel(
    managementToken: string,
    channel: PreferredContactChannel,
  ): Promise<PublicBookingManagementCard | null>;
}

export class PublicBookingValidationError extends Error {
  readonly issues: readonly PublicApplicantValidationIssue[];

  constructor(issues: readonly PublicApplicantValidationIssue[]) {
    super("Public booking applicant data is invalid");
    this.name = "PublicBookingValidationError";
    this.issues = issues;
  }
}

export class PublicBookingUnavailableError extends Error {
  constructor() {
    super("The selected occurrence is no longer publicly available");
    this.name = "PublicBookingUnavailableError";
  }
}

export class PublicBookingAgeMismatchError extends Error {
  constructor() {
    super("The exact birth date does not match the selected lesson age limits");
    this.name = "PublicBookingAgeMismatchError";
  }
}

export class PublicBookingTransitionError extends Error {
  constructor() {
    super("The requested booking transition is not allowed");
    this.name = "PublicBookingTransitionError";
  }
}

type WorkspacePublicBookingServiceOptions = {
  clock?: () => Date;
  idFactory?: () => string;
  tokenFactory?: () => string;
};

function bookingDraft(workspace: BookingWorkspace) {
  const { revision: _revision, ...draft } = workspace;
  return draft;
}

function managementCard(
  workspace: BookingWorkspace,
  booking: PublicLessonBooking,
): PublicBookingManagementCard | null {
  const occurrence = resolveStablePublicOccurrence(
    workspace,
    booking.lessonRef,
  );
  if (!occurrence) return null;
  const group = workspace.groups.find(
    (candidate) => candidate.id === occurrence.groupId,
  );
  const branch = workspace.branches.find(
    (candidate) => candidate.id === occurrence.branchId,
  );
  if (!group || !branch) return null;
  const teacherById = new Map(
    workspace.teachers.map((teacher) => [teacher.id, teacher]),
  );
  const room = occurrence.roomId
    ? workspace.rooms.find((candidate) => candidate.id === occurrence.roomId)
    : undefined;
  const canChange =
    booking.status === "pending_confirmation" || booking.status === "confirmed";

  return {
    status: booking.status,
    childName: booking.applicant.childName,
    maskedPhone: maskPublicBookingPhone(booking.applicant.phoneNormalized),
    preferredContactChannel: booking.applicant.preferredContactChannel,
    transferRequest: booking.transferRequest,
    organizationName: workspace.organization.name,
    branchName: branch.name,
    branchAddress: branch.address,
    groupName: group.name,
    ...(room ? { roomName: room.name } : {}),
    teacherNames: occurrence.teacherIds
      .map((teacherId) => teacherById.get(teacherId)?.displayName)
      .filter((name): name is string => Boolean(name)),
    date: occurrence.date,
    startTime: occurrence.startTime,
    endTime: occurrence.endTime,
    trialPolicy: occurrence.trialPolicy,
    purpose: booking.source.purpose,
    canCancel: canChange,
    canRequestTransfer: canChange,
  };
}

/**
 * Server-shaped public command/query adapter backed by a BookingRepository.
 * The browser demo uses this class with revision/Web Locks coordination; a
 * production adapter can implement the same interface with atomic server
 * commands without exposing BookingWorkspace mutations to the public UI.
 */
export class WorkspacePublicBookingService implements PublicBookingService {
  private readonly repository: BookingRepository;
  private readonly clock: () => Date;
  private readonly idFactory: () => string;
  private readonly tokenFactory: () => string;
  private commandTail: Promise<void> = Promise.resolve();
  private readonly credentialByBookingId = new Map<string, string>();

  constructor(
    repository: BookingRepository,
    options: WorkspacePublicBookingServiceOptions = {},
  ) {
    this.repository = repository;
    this.clock = options.clock ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.tokenFactory = options.tokenFactory ?? generatePublicBookingToken;
  }

  async getCatalog(): Promise<PublicBookingCatalog> {
    const workspace = await this.repository.load();
    return {
      organization: {
        id: workspace.organization.id,
        name: workspace.organization.name,
        locale: workspace.organization.locale,
        timeZone: workspace.organization.timeZone,
        currentDate: organizationLocalDateTime(
          workspace.organization.timeZone,
          this.clock(),
        ).date,
        publicBooking: workspace.organization.publicBooking,
      },
      branches: workspace.branches
        .filter((branch) => branch.status === "active")
        .map((branch) => ({
          id: branch.id,
          name: branch.name,
          address: branch.address,
        })),
    };
  }

  async findOccurrences(
    filters: PublicOccurrenceSearchFilters,
  ): Promise<PublicBookingOccurrence[]> {
    const workspace = await this.repository.load();
    return findPublicBookingOccurrences(workspace, filters, {
      now: this.clock(),
    });
  }

  async createBooking(
    command: CreatePublicBookingCommand,
  ): Promise<CreatePublicBookingResult> {
    const purpose = command.purpose ?? "trial";
    const issues = validatePublicApplicantDraft(command.applicant);
    if (issues.length) throw new PublicBookingValidationError(issues);
    if (
      command.idempotencyKey.trim().length < 16 ||
      command.idempotencyKey.length > 200
    ) {
      throw new PublicBookingValidationError([]);
    }
    const phoneNormalized = normalizePublicBookingPhone(
      command.applicant.phone,
    );
    if (!phoneNormalized) {
      throw new PublicBookingValidationError(["phone_invalid"]);
    }
    const idempotencyKeyDigest = await digestPublicBookingCredential(
      command.idempotencyKey,
    );
    const managementToken = this.tokenFactory();
    const managementTokenDigest =
      await digestPublicBookingCredential(managementToken);

    return this.runSerialized(async () => {
      for (let attempt = 0; attempt < MAX_REVISION_RETRIES; attempt += 1) {
        const workspace = await this.repository.load();
        const currentDate = organizationLocalDateTime(
          workspace.organization.timeZone,
          this.clock(),
        ).date;
        const currentIssues = validatePublicApplicantDraft(
          command.applicant,
          currentDate,
        );
        if (currentIssues.length) {
          throw new PublicBookingValidationError(currentIssues);
        }
        const existing = workspace.bookings.find(
          (booking) => booking.idempotencyKeyDigest === idempotencyKeyDigest,
        );
        if (existing) {
          const card = managementCard(workspace, existing);
          if (!card) throw new PublicBookingUnavailableError();
          return {
            managementToken:
              this.credentialByBookingId.get(existing.id) ?? null,
            card,
          };
        }

        const available = findPublicBookingOccurrences(
          workspace,
          { purpose },
          { now: this.clock(), includeFull: true },
        ).find(
          (occurrence) =>
            stableLessonReferenceKey(occurrence.lessonRef) ===
            stableLessonReferenceKey(command.lessonRef),
        );
        if (!available?.available) {
          throw new PublicBookingUnavailableError();
        }
        const group = workspace.groups.find(
          (candidate) => candidate.id === available.groupId,
        );
        if (
          !group ||
          !isExactBirthDateEligible(
            group,
            command.applicant.childBirthDate,
            available.date,
          )
        ) {
          throw new PublicBookingAgeMismatchError();
        }

        const now = this.clock().toISOString();
        const applicant = {
          parentName: command.applicant.parentName.trim(),
          phoneNormalized,
          phoneDisplay: command.applicant.phone.trim(),
          childName: command.applicant.childName.trim(),
          childBirthDate: command.applicant.childBirthDate,
          consentVersion: PUBLIC_BOOKING_CONSENT_VERSION,
          consentAcceptedAt: now,
          preferredContactChannel: command.preferredContactChannel ?? "none",
        } satisfies PublicLessonBooking["applicant"];
        const identity = resolveBookingApplicantIdentity(workspace, applicant, {
          now,
          idFactory: this.idFactory,
        });
        const booking: PublicLessonBooking = {
          id: `booking-${this.idFactory()}`,
          organizationId: workspace.organization.id,
          familyId: identity.familyId,
          representativeId: identity.representativeId,
          childId: identity.childId,
          lessonRef: command.lessonRef,
          applicant,
          visitKind: purpose === "lesson" ? "single" : "trial",
          status: "pending_confirmation",
          transferRequest: null,
          managementTokenDigest,
          idempotencyKeyDigest,
          source: {
            ...command.source,
            purpose,
            channel: "website",
            workflow: "request",
          },
          createdBy: "public-booking",
          createdAt: now,
          updatedAt: now,
        };
        const next: BookingWorkspace = {
          ...workspace,
          families: identity.families,
          representatives: identity.representatives,
          children: identity.children,
          duplicateCandidates: identity.duplicateCandidates,
          bookings: [...workspace.bookings, booking],
        };
        try {
          const saved = await this.repository.save(
            bookingDraft(next),
            workspace.revision,
          );
          this.credentialByBookingId.set(booking.id, managementToken);
          const card = managementCard(saved, booking);
          if (!card) throw new PublicBookingUnavailableError();
          return { managementToken, card };
        } catch (error) {
          if (error instanceof BookingRevisionConflictError) continue;
          throw error;
        }
      }
      throw new PublicBookingUnavailableError();
    });
  }

  async getManagementCard(
    managementToken: string,
  ): Promise<PublicBookingManagementCard | null> {
    const located = await this.findByToken(managementToken);
    return located ? managementCard(located.workspace, located.booking) : null;
  }

  async cancelByParent(
    managementToken: string,
  ): Promise<PublicBookingManagementCard | null> {
    return this.mutateByToken(managementToken, (booking, now) => {
      try {
        return transitionBookingStatus(booking, "cancelled_by_parent", now);
      } catch {
        throw new PublicBookingTransitionError();
      }
    });
  }

  async requestTransfer(
    managementToken: string,
    comment?: string,
  ): Promise<PublicBookingManagementCard | null> {
    const normalizedComment = comment?.trim();
    if (normalizedComment && normalizedComment.length > 1_000) {
      throw new PublicBookingTransitionError();
    }
    return this.mutateByToken(managementToken, (booking, now) => {
      if (
        booking.status !== "pending_confirmation" &&
        booking.status !== "confirmed"
      ) {
        throw new PublicBookingTransitionError();
      }
      if (booking.transferRequest) return booking;
      return {
        ...booking,
        transferRequest: {
          status: "pending",
          requestedAt: now,
          ...(normalizedComment ? { comment: normalizedComment } : {}),
        },
        updatedAt: now,
      };
    });
  }

  async setPreferredContactChannel(
    managementToken: string,
    channel: PreferredContactChannel,
  ): Promise<PublicBookingManagementCard | null> {
    return this.mutateByToken(managementToken, (booking, now) => ({
      ...booking,
      applicant: { ...booking.applicant, preferredContactChannel: channel },
      updatedAt: now,
    }));
  }

  private runSerialized<T>(task: () => Promise<T>): Promise<T> {
    const result = this.commandTail.then(task);
    this.commandTail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  private async findByToken(managementToken: string): Promise<{
    workspace: BookingWorkspace;
    booking: PublicLessonBooking;
  } | null> {
    if (!TOKEN_PATTERN.test(managementToken)) return null;
    const digest = await digestPublicBookingCredential(managementToken);
    const workspace = await this.repository.load();
    const booking = workspace.bookings.find(
      (candidate) => candidate.managementTokenDigest === digest,
    );
    return booking ? { workspace, booking } : null;
  }

  private mutateByToken(
    managementToken: string,
    update: (booking: PublicLessonBooking, now: string) => PublicLessonBooking,
  ): Promise<PublicBookingManagementCard | null> {
    return this.runSerialized(async () => {
      if (!TOKEN_PATTERN.test(managementToken)) return null;
      const digest = await digestPublicBookingCredential(managementToken);
      for (let attempt = 0; attempt < MAX_REVISION_RETRIES; attempt += 1) {
        const workspace = await this.repository.load();
        const bookingIndex = workspace.bookings.findIndex(
          (candidate) => candidate.managementTokenDigest === digest,
        );
        if (bookingIndex < 0) return null;
        const current = workspace.bookings[bookingIndex];
        const nextBooking = update(current, this.clock().toISOString());
        if (nextBooking === current) return managementCard(workspace, current);
        const bookings = [...workspace.bookings];
        bookings[bookingIndex] = nextBooking;
        try {
          const saved = await this.repository.save(
            bookingDraft({ ...workspace, bookings }),
            workspace.revision,
          );
          return managementCard(saved, nextBooking);
        } catch (error) {
          if (error instanceof BookingRevisionConflictError) continue;
          throw error;
        }
      }
      throw new PublicBookingUnavailableError();
    });
  }
}
