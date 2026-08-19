import {
  airhopActionCommandSchema,
  airhopActorSchema,
  type AirhopActionCommand,
  type AirhopActionContext,
  type AirhopActionPreview,
  type AirhopActionResult,
  type AirhopActor,
  type AirhopClientSelector,
} from "@/features/booking/actions/airhopActionSchemas";
import { previewAirhopAction } from "@/features/booking/actions/airhopActionPreview";
import type {
  BookingApplicantSnapshot,
  BookingWorkspace,
  BookingWorkspaceDraft,
  PublicLessonBooking,
} from "@/features/booking/model/bookingCore";
import { resolveBookingApplicantIdentity } from "@/features/booking/model/bookingClientIdentity";
import {
  createConfiguredEnrollmentWithPayment,
  createTariff,
  setPaymentStatus,
  setTariffStatus,
  updateExpectedPaymentAmount,
  updateExpectedPaymentDueDate,
  updateTariff,
} from "@/features/booking/model/bookingCommerce";
import {
  clearAttendanceRecord,
  upsertAttendanceRecord,
} from "@/features/booking/model/bookingMutations";
import {
  isEnrollmentActiveOn,
  lessonOccupancy,
  lessonParticipantChildIds,
  resolveAttendanceTracking,
  resolveSingleVisitAllowed,
} from "@/features/booking/model/bookingOperations";
import {
  isExactBirthDateEligible,
  stableLessonReferenceKey,
} from "@/features/booking/model/publicBooking";
import { materializeScheduleOccurrence } from "@/features/booking/model/materializeSchedule";

export type AirhopActionErrorCode =
  | "invalid_actor"
  | "identity_choice_required"
  | "client_not_found"
  | "inactive_client"
  | "group_unavailable"
  | "lesson_unavailable"
  | "age_mismatch"
  | "capacity_full"
  | "trial_disabled"
  | "single_visit_disabled"
  | "attendance_disabled"
  | "attendance_participant_missing"
  | "action_not_found"
  | "action_conflict"
  | "action_cancelled";

export class AirhopActionError extends Error {
  readonly code: AirhopActionErrorCode;

  constructor(code: AirhopActionErrorCode, message: string) {
    super(message);
    this.name = "AirhopActionError";
    this.code = code;
  }
}

type PlannedAction = {
  draft: BookingWorkspaceDraft;
  result: AirhopActionResult;
  preview: AirhopActionPreview;
};

type ResolvedClient = {
  workspace: BookingWorkspace;
  familyId: string;
  representativeId: string;
  childId: string;
  applicant: BookingApplicantSnapshot;
};

export type ExecutedAirhopAction = PlannedAction & {
  status: "executed";
};

export type PreparedAirhopAction = {
  draft: BookingWorkspaceDraft;
  action: BookingWorkspace["pendingActions"][number];
  preview: AirhopActionPreview;
  status: "prepared";
};

export type CommittedAirhopAction = {
  draft: BookingWorkspaceDraft;
  result: AirhopActionResult;
  status: "committed" | "expired";
};

function workspaceDraft(workspace: BookingWorkspace): BookingWorkspaceDraft {
  const { revision: _revision, ...draft } = workspace;
  return draft;
}

function withDraft(
  workspace: BookingWorkspace,
  draft: BookingWorkspaceDraft,
): BookingWorkspace {
  return { ...draft, revision: workspace.revision };
}

function requireDigest(value: string): string {
  if (!/^[a-f0-9]{64}$/.test(value)) {
    throw new Error("Airhop action digest must be 64 lowercase hex characters");
  }
  return value;
}

function applicantFromExisting(
  workspace: BookingWorkspace,
  selector: Extract<AirhopClientSelector, { mode: "existing" }>,
): ResolvedClient {
  const family = workspace.families.find(
    (candidate) => candidate.id === selector.familyId,
  );
  const representative = workspace.representatives.find(
    (candidate) => candidate.id === selector.representativeId,
  );
  const child = workspace.children.find(
    (candidate) => candidate.id === selector.childId,
  );
  if (
    !family ||
    !representative ||
    !child ||
    representative.familyId !== family.id ||
    child.familyId !== family.id
  ) {
    throw new AirhopActionError("client_not_found", "Client was not found");
  }
  if (
    family.status !== "active" ||
    representative.status !== "active" ||
    child.status !== "active"
  ) {
    throw new AirhopActionError("inactive_client", "Client is archived");
  }
  return {
    workspace,
    familyId: family.id,
    representativeId: representative.id,
    childId: child.id,
    applicant: {
      parentName: representative.displayName,
      phoneNormalized: representative.phoneNormalized,
      phoneDisplay: representative.phoneDisplay,
      childName: child.displayName,
      childBirthDate: child.birthDate,
      consentVersion: representative.consentVersion,
      consentAcceptedAt: representative.consentAcceptedAt,
      preferredContactChannel: representative.preferredContactChannel,
    },
  };
}

function applicantFromNew(
  workspace: BookingWorkspace,
  selector: Extract<AirhopClientSelector, { mode: "new" }>,
  context: AirhopActionContext,
): ResolvedClient {
  const activeRepresentatives = workspace.representatives.filter(
    (representative) =>
      representative.status === "active" &&
      representative.phoneNormalized === selector.applicant.phoneNormalized &&
      workspace.families.some(
        (family) =>
          family.id === representative.familyId && family.status === "active",
      ),
  );
  if (activeRepresentatives.length > 1) {
    throw new AirhopActionError(
      "identity_choice_required",
      "Several active families use this phone",
    );
  }
  if (activeRepresentatives.length === 1) {
    const matchingChildren = workspace.children.filter(
      (child) =>
        child.status === "active" &&
        child.familyId === activeRepresentatives[0].familyId &&
        child.birthDate === selector.applicant.childBirthDate &&
        child.displayName
          .trim()
          .toLocaleLowerCase(workspace.organization.locale) ===
          selector.applicant.childName
            .trim()
            .toLocaleLowerCase(workspace.organization.locale),
    );
    if (matchingChildren.length > 1) {
      throw new AirhopActionError(
        "identity_choice_required",
        "Several children match this identity",
      );
    }
  }
  const identity = resolveBookingApplicantIdentity(
    workspace,
    selector.applicant,
    { now: context.now, idFactory: context.idFactory },
  );
  return {
    workspace: {
      ...workspace,
      families: identity.families,
      representatives: identity.representatives,
      children: identity.children,
      duplicateCandidates: identity.duplicateCandidates,
    },
    familyId: identity.familyId,
    representativeId: identity.representativeId,
    childId: identity.childId,
    applicant: selector.applicant,
  };
}

function resolveClient(
  workspace: BookingWorkspace,
  selector: AirhopClientSelector,
  context: AirhopActionContext,
): ResolvedClient {
  return selector.mode === "existing"
    ? applicantFromExisting(workspace, selector)
    : applicantFromNew(workspace, selector, context);
}

function activeGroup(workspace: BookingWorkspace, groupId: string) {
  const group = workspace.groups.find((candidate) => candidate.id === groupId);
  const branch = group
    ? workspace.branches.find((candidate) => candidate.id === group.branchId)
    : undefined;
  if (group?.status !== "active" || branch?.status !== "active") {
    throw new AirhopActionError("group_unavailable", "Group is not available");
  }
  return { group, branch };
}

function bookingStatusFor(
  command: Extract<
    AirhopActionCommand,
    { type: "CreateBookingRequest" | "AddLessonParticipant" }
  >,
  actor: AirhopActor,
): "pending_confirmation" | "confirmed" {
  if (command.type === "CreateBookingRequest") return "pending_confirmation";
  if (command.submissionMode === "direct") {
    if (actor.surface !== "staff_ui") {
      throw new AirhopActionError(
        "invalid_actor",
        "Only staff UI can confirm a direct booking",
      );
    }
    return "confirmed";
  }
  return "pending_confirmation";
}

function planEnrollment(
  workspace: BookingWorkspace,
  command: Extract<AirhopActionCommand, { type: "CreateExistingStudent" }>,
  actor: AirhopActor,
  context: AirhopActionContext,
): PlannedAction {
  const client = resolveClient(workspace, command.client, context);
  activeGroup(client.workspace, command.groupId);
  const existing = client.workspace.enrollments.find(
    (enrollment) =>
      enrollment.status === "active" &&
      enrollment.childId === client.childId &&
      enrollment.groupId === command.groupId &&
      (enrollment.endDate === undefined ||
        enrollment.endDate >= command.startDate),
  );
  if (existing) {
    return {
      draft: workspaceDraft(client.workspace),
      result: { commandType: command.type, entityIds: [existing.id] },
      preview: previewAirhopAction(workspace, command, client),
    };
  }
  const enrollmentId = `enrollment-${context.idFactory()}`;
  const paymentId = `payment-${context.idFactory()}`;
  const tariff = client.workspace.tariffs.find(
    (candidate) => candidate.id === command.tariffId,
  );
  if (!tariff) {
    throw new AirhopActionError("group_unavailable", "Tariff is unavailable");
  }
  const draft = createConfiguredEnrollmentWithPayment(client.workspace, {
    enrollment: {
      id: enrollmentId,
      organizationId: workspace.organization.id,
      familyId: client.familyId,
      childId: client.childId,
      groupId: command.groupId,
      startDate: command.startDate,
      status: "active",
      source: actor.surface,
      createdBy: actor.userId,
      assignmentState: "configured",
      tariffId: command.tariffId,
      weeklyScheduleSelections: command.weeklyScheduleSelections,
      createdAt: context.now,
      updatedAt: context.now,
    },
    payment: {
      id: paymentId,
      organizationId: workspace.organization.id,
      familyId: client.familyId,
      childId: client.childId,
      enrollmentId,
      tariffId: tariff.id,
      tariffNameSnapshot: tariff.name,
      amountMinor: tariff.priceMinor,
      currency: tariff.currency,
      dueDate: command.startDate,
      status: "expected",
      createdAt: context.now,
      updatedAt: context.now,
    },
  });
  return {
    draft,
    result: {
      commandType: command.type,
      entityIds: [
        client.familyId,
        client.representativeId,
        client.childId,
        enrollmentId,
        paymentId,
      ],
    },
    preview: previewAirhopAction(workspace, command, client),
  };
}

function planCommerceCommand(
  workspace: BookingWorkspace,
  command: Extract<
    AirhopActionCommand,
    {
      type:
        | "CreateTariff"
        | "UpdateTariff"
        | "SetTariffStatus"
        | "SetPaymentStatus"
        | "UpdatePaymentAmount"
        | "UpdatePaymentDueDate";
    }
  >,
  actor: AirhopActor,
  context: AirhopActionContext,
): PlannedAction {
  let draft: BookingWorkspaceDraft;
  let entityId: string;
  if (command.type === "CreateTariff") {
    entityId = `tariff-${context.idFactory()}`;
    draft = createTariff(workspace, {
      id: entityId,
      organizationId: workspace.organization.id,
      name: command.name,
      ...(command.description ? { description: command.description } : {}),
      priceMinor: command.priceMinor,
      currency: command.currency,
      weeklyScheduleLimit: command.weeklyScheduleLimit,
      ...(command.paymentDayOfMonth
        ? { paymentDayOfMonth: command.paymentDayOfMonth }
        : {}),
      status: "active",
      createdAt: context.now,
      updatedAt: context.now,
    });
  } else if (command.type === "UpdateTariff") {
    const tariff = workspace.tariffs.find(
      (candidate) => candidate.id === command.tariffId,
    );
    if (!tariff) {
      throw new AirhopActionError("group_unavailable", "Tariff is unavailable");
    }
    entityId = tariff.id;
    draft = updateTariff(workspace, {
      ...tariff,
      name: command.name,
      description: command.description,
      priceMinor: command.priceMinor,
      currency: command.currency,
      weeklyScheduleLimit: command.weeklyScheduleLimit,
      paymentDayOfMonth: command.paymentDayOfMonth,
      updatedAt: context.now,
    });
  } else if (command.type === "SetTariffStatus") {
    entityId = command.tariffId;
    draft = setTariffStatus(
      workspace,
      command.tariffId,
      command.status,
      context.now,
    );
  } else if (command.type === "UpdatePaymentAmount") {
    entityId = command.paymentId;
    draft = updateExpectedPaymentAmount(workspace, command.paymentId, {
      amountMinor: command.amountMinor,
      updatedAt: context.now,
    });
  } else if (command.type === "UpdatePaymentDueDate") {
    entityId = command.paymentId;
    draft = updateExpectedPaymentDueDate(workspace, command.paymentId, {
      dueDate: command.dueDate,
      updatedAt: context.now,
    });
  } else {
    entityId = command.paymentId;
    draft = setPaymentStatus(workspace, command.paymentId, {
      status: command.status,
      actorId: actor.userId,
      occurredAt: context.now,
      ...(command.internalReason
        ? { internalReason: command.internalReason }
        : {}),
    });
  }
  return {
    draft,
    result: { commandType: command.type, entityIds: [entityId] },
    preview: previewAirhopAction(workspace, command),
  };
}

function planBooking(
  workspace: BookingWorkspace,
  command: Extract<
    AirhopActionCommand,
    { type: "CreateBookingRequest" | "AddLessonParticipant" }
  >,
  actor: AirhopActor,
  context: AirhopActionContext,
): PlannedAction {
  const targetStatus = bookingStatusFor(command, actor);
  const client = resolveClient(workspace, command.client, context);
  const occurrence = materializeScheduleOccurrence(
    client.workspace,
    command.lessonRef.recurrenceRuleId,
    command.lessonRef.originalDate,
  );
  if (!occurrence || occurrence.status === "cancelled") {
    throw new AirhopActionError(
      "lesson_unavailable",
      "Lesson is not available",
    );
  }
  const { group } = activeGroup(client.workspace, occurrence.groupId);
  if (
    command.visitKind === "trial" &&
    occurrence.trialPolicy.mode === "disabled"
  ) {
    throw new AirhopActionError("trial_disabled", "Trial visit is disabled");
  }
  if (
    command.visitKind === "single" &&
    !resolveSingleVisitAllowed(client.workspace, command.lessonRef)
  ) {
    throw new AirhopActionError(
      "single_visit_disabled",
      "Single visit is disabled",
    );
  }
  if (
    !isExactBirthDateEligible(
      group,
      client.applicant.childBirthDate,
      occurrence.date,
    )
  ) {
    throw new AirhopActionError("age_mismatch", "Child age does not match");
  }
  const idempotencyDigest = requireDigest(
    context.digest(`airhop-action:${context.idempotencyKey}`),
  );
  const idempotent = client.workspace.bookings.find(
    (booking) => booking.idempotencyKeyDigest === idempotencyDigest,
  );
  const referenceKey = stableLessonReferenceKey(command.lessonRef);
  const duplicate = client.workspace.bookings.find(
    (booking) =>
      booking.childId === client.childId &&
      stableLessonReferenceKey(booking.lessonRef) === referenceKey &&
      (booking.status === "pending_confirmation" ||
        booking.status === "confirmed"),
  );
  const existingBooking = idempotent ?? duplicate;
  if (existingBooking) {
    const bookings =
      targetStatus === "confirmed" &&
      existingBooking.status === "pending_confirmation"
        ? client.workspace.bookings.map((booking) =>
            booking.id === existingBooking.id
              ? {
                  ...booking,
                  status: "confirmed" as const,
                  source: { ...booking.source, workflow: "direct" as const },
                  updatedAt: context.now,
                }
              : booking,
          )
        : client.workspace.bookings;
    return {
      draft: { ...workspaceDraft(client.workspace), bookings },
      result: { commandType: command.type, entityIds: [existingBooking.id] },
      preview: previewAirhopAction(workspace, command, client),
    };
  }
  const activeEnrollment = client.workspace.enrollments.find(
    (enrollment) =>
      enrollment.childId === client.childId &&
      enrollment.groupId === occurrence.groupId &&
      isEnrollmentActiveOn(enrollment, occurrence.date),
  );
  if (activeEnrollment) {
    return {
      draft: workspaceDraft(client.workspace),
      result: { commandType: command.type, entityIds: [activeEnrollment.id] },
      preview: previewAirhopAction(workspace, command, client),
    };
  }
  const occupied = lessonOccupancy(client.workspace, {
    groupId: occurrence.groupId,
    date: occurrence.date,
    lessonRef: command.lessonRef,
  });
  if (occurrence.capacity !== undefined && occupied >= occurrence.capacity) {
    throw new AirhopActionError("capacity_full", "Lesson is full");
  }
  const bookingId = `booking-${context.idFactory()}`;
  const booking: PublicLessonBooking = {
    id: bookingId,
    organizationId: workspace.organization.id,
    familyId: client.familyId,
    representativeId: client.representativeId,
    childId: client.childId,
    lessonRef: command.lessonRef,
    applicant: client.applicant,
    visitKind: command.visitKind,
    status: targetStatus,
    transferRequest: null,
    managementTokenDigest: requireDigest(
      context.digest(`airhop-management:${context.idempotencyKey}`),
    ),
    idempotencyKeyDigest: idempotencyDigest,
    source: {
      surface: actor.surface,
      purpose: command.visitKind === "trial" ? "trial" : "lesson",
      channel: command.sourceChannel,
      workflow:
        command.type === "AddLessonParticipant"
          ? command.submissionMode
          : "request",
      attributionBranchId: occurrence.branchId,
    },
    createdBy: actor.userId,
    ...(command.internalComment
      ? { internalComment: command.internalComment }
      : {}),
    createdAt: context.now,
    updatedAt: context.now,
  };
  return {
    draft: {
      ...workspaceDraft(client.workspace),
      bookings: [...client.workspace.bookings, booking],
    },
    result: {
      commandType: command.type,
      entityIds: [
        client.familyId,
        client.representativeId,
        client.childId,
        bookingId,
      ],
    },
    preview: previewAirhopAction(workspace, command, client),
  };
}

function planIntake(
  workspace: BookingWorkspace,
  command: Extract<AirhopActionCommand, { type: "CreateUnassignedRequest" }>,
  actor: AirhopActor,
  context: AirhopActionContext,
): PlannedAction {
  const client = resolveClient(workspace, command.client, context);
  if (command.branchId) {
    const branch = client.workspace.branches.find(
      (candidate) => candidate.id === command.branchId,
    );
    if (branch?.status !== "active") {
      throw new AirhopActionError(
        "group_unavailable",
        "Branch is not available",
      );
    }
  }
  if (command.groupId) activeGroup(client.workspace, command.groupId);
  const requestId = `intake-${context.idFactory()}`;
  return {
    draft: {
      ...workspaceDraft(client.workspace),
      intakeRequests: [
        ...client.workspace.intakeRequests,
        {
          id: requestId,
          organizationId: workspace.organization.id,
          familyId: client.familyId,
          representativeId: client.representativeId,
          childId: client.childId,
          ...(command.branchId ? { branchId: command.branchId } : {}),
          ...(command.groupId ? { groupId: command.groupId } : {}),
          sourceChannel: command.sourceChannel,
          ...(command.internalComment
            ? { internalComment: command.internalComment }
            : {}),
          status: "new",
          createdBy: actor.userId,
          createdAt: context.now,
          updatedAt: context.now,
        },
      ],
    },
    result: {
      commandType: command.type,
      entityIds: [
        client.familyId,
        client.representativeId,
        client.childId,
        requestId,
      ],
    },
    preview: previewAirhopAction(workspace, command, client),
  };
}

function planAttendance(
  workspace: BookingWorkspace,
  command: Extract<AirhopActionCommand, { type: "MarkAttendance" }>,
  actor: AirhopActor,
  context: AirhopActionContext,
): PlannedAction {
  const child = workspace.children.find(
    (candidate) => candidate.id === command.childId,
  );
  const occurrence = materializeScheduleOccurrence(
    workspace,
    command.lessonRef.recurrenceRuleId,
    command.lessonRef.originalDate,
  );
  if (child?.status !== "active") {
    throw new AirhopActionError("client_not_found", "Child was not found");
  }
  if (!occurrence || occurrence.status === "cancelled") {
    throw new AirhopActionError(
      "lesson_unavailable",
      "Lesson is not available",
    );
  }
  if (!resolveAttendanceTracking(workspace, occurrence.groupId)) {
    throw new AirhopActionError(
      "attendance_disabled",
      "Attendance tracking is disabled",
    );
  }
  const participants = lessonParticipantChildIds(workspace, {
    groupId: occurrence.groupId,
    date: occurrence.date,
    lessonRef: command.lessonRef,
  });
  if (!participants.has(child.id)) {
    throw new AirhopActionError(
      "attendance_participant_missing",
      "Child is not a participant of this lesson",
    );
  }
  const existing = workspace.attendanceRecords.find(
    (record) =>
      record.childId === child.id &&
      stableLessonReferenceKey(record.lessonRef) ===
        stableLessonReferenceKey(command.lessonRef),
  );
  const draft = command.status
    ? upsertAttendanceRecord(workspace, {
        id: existing?.id ?? `attendance-${context.idFactory()}`,
        organizationId: workspace.organization.id,
        childId: child.id,
        lessonRef: command.lessonRef,
        status: command.status,
        markedBy: actor.userId,
        markedAt: existing?.markedAt ?? context.now,
        updatedAt: context.now,
      })
    : clearAttendanceRecord(workspace, child.id, command.lessonRef);
  return {
    draft,
    result: {
      commandType: command.type,
      entityIds: command.status
        ? [existing?.id ?? draft.attendanceRecords.at(-1)?.id ?? ""]
        : [],
    },
    preview: previewAirhopAction(workspace, command),
  };
}

function planAirhopAction(
  workspace: BookingWorkspace,
  commandInput: AirhopActionCommand,
  actorInput: AirhopActor,
  context: AirhopActionContext,
): PlannedAction {
  const command = airhopActionCommandSchema.parse(commandInput);
  const actor = airhopActorSchema.parse(actorInput);
  if (command.type === "CreateExistingStudent") {
    return planEnrollment(workspace, command, actor, context);
  }
  if (
    command.type === "CreateTariff" ||
    command.type === "UpdateTariff" ||
    command.type === "SetTariffStatus" ||
    command.type === "SetPaymentStatus" ||
    command.type === "UpdatePaymentAmount" ||
    command.type === "UpdatePaymentDueDate"
  ) {
    return planCommerceCommand(workspace, command, actor, context);
  }
  if (
    command.type === "CreateBookingRequest" ||
    command.type === "AddLessonParticipant"
  ) {
    return planBooking(workspace, command, actor, context);
  }
  if (command.type === "CreateUnassignedRequest") {
    return planIntake(workspace, command, actor, context);
  }
  return planAttendance(workspace, command, actor, context);
}

export function executeAirhopAction(
  workspace: BookingWorkspace,
  command: AirhopActionCommand,
  actor: AirhopActor,
  context: AirhopActionContext,
): ExecutedAirhopAction {
  const parsedActor = airhopActorSchema.parse(actor);
  if (parsedActor.surface !== "staff_ui") {
    throw new AirhopActionError(
      "invalid_actor",
      "Buzz agent mutations require preview and confirmation",
    );
  }
  return {
    ...planAirhopAction(workspace, command, parsedActor, context),
    status: "executed",
  };
}

function serializedCommand(command: AirhopActionCommand) {
  const { type, ...payload } = command;
  return { type, payload };
}

function restoredCommand(
  command: BookingWorkspace["pendingActions"][number]["command"],
): AirhopActionCommand {
  return airhopActionCommandSchema.parse({
    type: command.type,
    ...command.payload,
  });
}

export function prepareAirhopAction(
  workspace: BookingWorkspace,
  commandInput: AirhopActionCommand,
  actorInput: AirhopActor,
  context: AirhopActionContext,
): PreparedAirhopAction {
  const command = airhopActionCommandSchema.parse(commandInput);
  const actor = airhopActorSchema.parse(actorInput);
  if (actor.surface !== "buzz_agent") {
    throw new AirhopActionError(
      "invalid_actor",
      "Prepared action needs Buzz agent metadata",
    );
  }
  if (actor.specialistRole !== "administrator") {
    throw new AirhopActionError(
      "invalid_actor",
      `${actor.specialistRole} cannot prepare mutations`,
    );
  }
  const existing = workspace.pendingActions.find(
    (action) =>
      action.idempotencyKey === context.idempotencyKey &&
      action.status === "pending",
  );
  if (existing) {
    return {
      draft: workspaceDraft(workspace),
      action: existing,
      preview: existing.preview,
      status: "prepared",
    };
  }
  const plan = planAirhopAction(workspace, command, actor, context);
  const storedCommand = serializedCommand(command);
  const action = {
    id: `pending-action-${context.idFactory()}`,
    organizationId: workspace.organization.id,
    command: storedCommand,
    expectedRevision: workspace.revision + 1,
    checksum: requireDigest(context.digest(JSON.stringify(storedCommand))),
    idempotencyKey: context.idempotencyKey,
    initiatedBy: actor.userId,
    preparedByAgentId: actor.agentId,
    specialistRole: actor.specialistRole,
    channelId: actor.channelId,
    threadId: actor.threadId ?? actor.channelId,
    preview: plan.preview,
    status: "pending" as const,
    createdAt: context.now,
    expiresAt: new Date(
      new Date(context.now).getTime() + 24 * 60 * 60 * 1_000,
    ).toISOString(),
  };
  return {
    draft: {
      ...workspaceDraft(workspace),
      pendingActions: [...workspace.pendingActions, action],
    },
    action,
    preview: plan.preview,
    status: "prepared",
  };
}

export function commitAirhopAction(
  workspace: BookingWorkspace,
  actionId: string,
  confirmer: string,
  context: AirhopActionContext,
): CommittedAirhopAction {
  const action = workspace.pendingActions.find(
    (candidate) => candidate.id === actionId,
  );
  if (!action) {
    throw new AirhopActionError("action_not_found", "Action was not found");
  }
  if (action.status === "committed") {
    return {
      draft: workspaceDraft(workspace),
      result: {
        commandType: restoredCommand(action.command).type,
        entityIds: action.resultIds ?? [],
      },
      status: "committed",
    };
  }
  if (action.status === "cancelled") {
    throw new AirhopActionError("action_cancelled", "Action was cancelled");
  }
  if (action.status !== "pending") {
    throw new AirhopActionError(
      "action_conflict",
      "Action cannot be committed",
    );
  }
  if (context.now >= action.expiresAt) {
    return {
      draft: {
        ...workspaceDraft(workspace),
        pendingActions: workspace.pendingActions.map((candidate) =>
          candidate.id === action.id
            ? { ...candidate, status: "expired" as const }
            : candidate,
        ),
      },
      result: {
        commandType: restoredCommand(action.command).type,
        entityIds: [],
      },
      status: "expired",
    };
  }
  if (
    workspace.revision !== action.expectedRevision ||
    requireDigest(context.digest(JSON.stringify(action.command))) !==
      action.checksum
  ) {
    throw new AirhopActionError(
      "action_conflict",
      "Workspace changed after preview",
    );
  }
  const command = restoredCommand(action.command);
  const plan = planAirhopAction(
    workspace,
    command,
    {
      userId: action.initiatedBy,
      surface: "buzz_agent",
      agentId: action.preparedByAgentId,
      specialistRole: action.specialistRole,
      channelId: action.channelId,
      threadId: action.threadId,
    },
    { ...context, idempotencyKey: action.idempotencyKey },
  );
  const plannedWorkspace = withDraft(workspace, plan.draft);
  return {
    draft: {
      ...plan.draft,
      pendingActions: plannedWorkspace.pendingActions.map((candidate) =>
        candidate.id === action.id
          ? {
              ...candidate,
              status: "committed" as const,
              resultIds: plan.result.entityIds,
              confirmedAt: context.now,
              confirmedBy: confirmer,
            }
          : candidate,
      ),
    },
    result: plan.result,
    status: "committed",
  };
}
