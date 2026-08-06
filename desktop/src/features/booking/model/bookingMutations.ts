import {
  attendanceRecordSchema,
  childSchema,
  enrollmentSchema,
  familySchema,
  groupSchema,
  isRecurrenceRuleOccurrence,
  lessonExceptionSchema,
  recurrenceRuleSchema,
  representativeSchema,
  roomSchema,
  teacherSchema,
  type BookingGroup,
  type BookingAttendanceRecord,
  type BookingChild,
  type BookingEnrollment,
  type BookingFamily,
  type BookingRepresentative,
  type PublicLessonBooking,
  type BookingRoom,
  type BookingTeacher,
  type BookingWorkspace,
  type BookingWorkspaceDraft,
  type LessonEffective,
  type LessonException,
  type LessonOriginal,
  type RecurrenceRule,
  type StableLessonReference,
} from "@/features/booking/model/bookingCore";
import {
  stableLessonReferenceKey,
  transitionBookingStatus,
} from "@/features/booking/model/publicBooking";
import { materializeScheduleOccurrence } from "@/features/booking/model/materializeSchedule";

export class BookingEntityMutationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BookingEntityMutationError";
  }
}

function workspaceDraft(workspace: BookingWorkspace): BookingWorkspaceDraft {
  const { revision: _revision, ...draft } = workspace;
  return draft;
}

function requireOrganization(
  workspace: BookingWorkspace,
  organizationId: string,
): void {
  if (organizationId !== workspace.organization.id) {
    throw new BookingEntityMutationError(
      `Entity belongs to unknown organization ${organizationId}`,
    );
  }
}

function rangesOverlap(
  left: Pick<BookingEnrollment, "startDate" | "endDate">,
  right: Pick<BookingEnrollment, "startDate" | "endDate">,
): boolean {
  return (
    (left.endDate === undefined || left.endDate >= right.startDate) &&
    (right.endDate === undefined || right.endDate >= left.startDate)
  );
}

export function createEnrollment(
  workspace: BookingWorkspace,
  input: BookingEnrollment,
): BookingWorkspaceDraft {
  const enrollment = enrollmentSchema.parse(input);
  requireOrganization(workspace, enrollment.organizationId);
  const family = workspace.families.find(
    (candidate) => candidate.id === enrollment.familyId,
  );
  const child = workspace.children.find(
    (candidate) => candidate.id === enrollment.childId,
  );
  const group = workspace.groups.find(
    (candidate) => candidate.id === enrollment.groupId,
  );
  if (!family) {
    throw new BookingEntityMutationError(
      `Unknown family ${enrollment.familyId}`,
    );
  }
  if (!child || child.familyId !== family.id) {
    throw new BookingEntityMutationError(
      `Unknown child ${enrollment.childId} in family ${family.id}`,
    );
  }
  if (!group) {
    throw new BookingEntityMutationError(
      `Unknown group ${enrollment.groupId}`,
    );
  }
  if (workspace.enrollments.some((candidate) => candidate.id === enrollment.id)) {
    throw new BookingEntityMutationError(
      `Enrollment ${enrollment.id} already exists`,
    );
  }
  if (
    enrollment.status === "active" &&
    workspace.enrollments.some(
      (candidate) =>
        candidate.status === "active" &&
        candidate.childId === enrollment.childId &&
        candidate.groupId === enrollment.groupId &&
        rangesOverlap(candidate, enrollment),
    )
  ) {
    throw new BookingEntityMutationError(
      `Child ${enrollment.childId} is already enrolled in group ${enrollment.groupId}`,
    );
  }
  return {
    ...workspaceDraft(workspace),
    enrollments: [...workspace.enrollments, enrollment],
  };
}

export function upsertAttendanceRecord(
  workspace: BookingWorkspace,
  input: BookingAttendanceRecord,
): BookingWorkspaceDraft {
  const attendance = attendanceRecordSchema.parse(input);
  requireOrganization(workspace, attendance.organizationId);
  if (!workspace.children.some((child) => child.id === attendance.childId)) {
    throw new BookingEntityMutationError(
      `Unknown child ${attendance.childId}`,
    );
  }
  if (
    !materializeScheduleOccurrence(
      workspace,
      attendance.lessonRef.recurrenceRuleId,
      attendance.lessonRef.originalDate,
    )
  ) {
    throw new BookingEntityMutationError(
      `Unknown lesson ${stableLessonReferenceKey(attendance.lessonRef)}`,
    );
  }
  const referenceKey = stableLessonReferenceKey(attendance.lessonRef);
  const existing = workspace.attendanceRecords.find(
    (candidate) =>
      candidate.childId === attendance.childId &&
      stableLessonReferenceKey(candidate.lessonRef) === referenceKey,
  );
  if (
    workspace.attendanceRecords.some(
      (candidate) => candidate.id === attendance.id && candidate !== existing,
    )
  ) {
    throw new BookingEntityMutationError(
      `Attendance record ${attendance.id} already exists`,
    );
  }
  return {
    ...workspaceDraft(workspace),
    attendanceRecords: existing
      ? workspace.attendanceRecords.map((candidate) =>
          candidate.id === existing.id ? attendance : candidate,
        )
      : [...workspace.attendanceRecords, attendance],
  };
}

export function clearAttendanceRecord(
  workspace: BookingWorkspace,
  childId: string,
  lessonRef: StableLessonReference,
): BookingWorkspaceDraft {
  const referenceKey = stableLessonReferenceKey(lessonRef);
  return {
    ...workspaceDraft(workspace),
    attendanceRecords: workspace.attendanceRecords.filter(
      (candidate) =>
        candidate.childId !== childId ||
        stableLessonReferenceKey(candidate.lessonRef) !== referenceKey,
    ),
  };
}

export function upsertBookingFamily(
  workspace: BookingWorkspace,
  input: BookingFamily,
): BookingWorkspaceDraft {
  const family = familySchema.parse(input);
  requireOrganization(workspace, family.organizationId);
  const primaryRepresentative = workspace.representatives.find(
    (representative) => representative.id === family.primaryRepresentativeId,
  );
  if (!primaryRepresentative) {
    throw new BookingEntityMutationError(
      `Unknown representative ${family.primaryRepresentativeId}`,
    );
  }
  if (primaryRepresentative.familyId !== family.id) {
    throw new BookingEntityMutationError(
      `Representative ${primaryRepresentative.id} does not belong to family ${family.id}`,
    );
  }
  const exists = workspace.families.some(
    (candidate) => candidate.id === family.id,
  );
  return {
    ...workspaceDraft(workspace),
    families: exists
      ? workspace.families.map((candidate) =>
          candidate.id === family.id ? family : candidate,
        )
      : [...workspace.families, family],
  };
}

export function upsertBookingRepresentative(
  workspace: BookingWorkspace,
  input: BookingRepresentative,
): BookingWorkspaceDraft {
  const representative = representativeSchema.parse(input);
  requireOrganization(workspace, representative.organizationId);
  if (
    !workspace.families.some((family) => family.id === representative.familyId)
  ) {
    throw new BookingEntityMutationError(
      `Unknown family ${representative.familyId}`,
    );
  }
  const existing = workspace.representatives.find(
    (candidate) => candidate.id === representative.id,
  );
  if (existing && existing.familyId !== representative.familyId) {
    throw new BookingEntityMutationError(
      `Representative ${representative.id} cannot move to another family`,
    );
  }
  return {
    ...workspaceDraft(workspace),
    representatives: existing
      ? workspace.representatives.map((candidate) =>
          candidate.id === representative.id ? representative : candidate,
        )
      : [...workspace.representatives, representative],
  };
}

export function upsertBookingChild(
  workspace: BookingWorkspace,
  input: BookingChild,
): BookingWorkspaceDraft {
  const child = childSchema.parse(input);
  requireOrganization(workspace, child.organizationId);
  if (!workspace.families.some((family) => family.id === child.familyId)) {
    throw new BookingEntityMutationError(`Unknown family ${child.familyId}`);
  }
  const existing = workspace.children.find(
    (candidate) => candidate.id === child.id,
  );
  if (existing && existing.familyId !== child.familyId) {
    throw new BookingEntityMutationError(
      `Child ${child.id} cannot move to another family`,
    );
  }
  return {
    ...workspaceDraft(workspace),
    children: existing
      ? workspace.children.map((candidate) =>
          candidate.id === child.id ? child : candidate,
        )
      : [...workspace.children, child],
  };
}

export function setBookingFamilyStatus(
  workspace: BookingWorkspace,
  familyId: string,
  status: BookingFamily["status"],
  updatedAt: string,
): BookingWorkspaceDraft {
  if (!workspace.families.some((family) => family.id === familyId)) {
    throw new BookingEntityMutationError(`Unknown family ${familyId}`);
  }
  return {
    ...workspaceDraft(workspace),
    families: workspace.families.map((family) =>
      family.id === familyId ? { ...family, status, updatedAt } : family,
    ),
  };
}

export function setStaffBookingStatus(
  workspace: BookingWorkspace,
  bookingId: string,
  status: "confirmed" | "rejected",
  updatedAt: string,
): BookingWorkspaceDraft {
  const booking = workspace.bookings.find(
    (candidate) => candidate.id === bookingId,
  );
  if (!booking) {
    throw new BookingEntityMutationError(`Unknown booking ${bookingId}`);
  }
  let updated: PublicLessonBooking;
  try {
    updated = transitionBookingStatus(booking, status, updatedAt);
  } catch {
    throw new BookingEntityMutationError(
      `Invalid booking transition ${booking.status} -> ${status}`,
    );
  }
  return {
    ...workspaceDraft(workspace),
    bookings: workspace.bookings.map((candidate) =>
      candidate.id === bookingId ? updated : candidate,
    ),
  };
}

export function upsertBookingTeacher(
  workspace: BookingWorkspace,
  input: BookingTeacher,
): BookingWorkspaceDraft {
  const teacher = teacherSchema.parse(input);
  requireOrganization(workspace, teacher.organizationId);
  const exists = workspace.teachers.some(
    (candidate) => candidate.id === teacher.id,
  );
  return {
    ...workspaceDraft(workspace),
    teachers: exists
      ? workspace.teachers.map((candidate) =>
          candidate.id === teacher.id ? teacher : candidate,
        )
      : [...workspace.teachers, teacher],
  };
}

export function setBookingTeacherStatus(
  workspace: BookingWorkspace,
  teacherId: string,
  status: BookingTeacher["status"],
): BookingWorkspaceDraft {
  if (!workspace.teachers.some((teacher) => teacher.id === teacherId)) {
    throw new BookingEntityMutationError(`Unknown teacher ${teacherId}`);
  }
  return {
    ...workspaceDraft(workspace),
    teachers: workspace.teachers.map((teacher) =>
      teacher.id === teacherId ? { ...teacher, status } : teacher,
    ),
  };
}

export function upsertBookingRoom(
  workspace: BookingWorkspace,
  input: BookingRoom,
): BookingWorkspaceDraft {
  const room = roomSchema.parse(input);
  requireOrganization(workspace, room.organizationId);
  if (!workspace.branches.some((branch) => branch.id === room.branchId)) {
    throw new BookingEntityMutationError(`Unknown branch ${room.branchId}`);
  }
  const existing = workspace.rooms.find(
    (candidate) => candidate.id === room.id,
  );
  if (existing && existing.branchId !== room.branchId) {
    throw new BookingEntityMutationError(
      `Room ${room.id} cannot move to another branch`,
    );
  }
  return {
    ...workspaceDraft(workspace),
    rooms: existing
      ? workspace.rooms.map((candidate) =>
          candidate.id === room.id ? room : candidate,
        )
      : [...workspace.rooms, room],
  };
}

export function setBookingRoomStatus(
  workspace: BookingWorkspace,
  roomId: string,
  status: BookingRoom["status"],
): BookingWorkspaceDraft {
  if (!workspace.rooms.some((room) => room.id === roomId)) {
    throw new BookingEntityMutationError(`Unknown room ${roomId}`);
  }
  return {
    ...workspaceDraft(workspace),
    rooms: workspace.rooms.map((room) =>
      room.id === roomId ? { ...room, status } : room,
    ),
  };
}

export function upsertBookingGroup(
  workspace: BookingWorkspace,
  input: {
    group: BookingGroup;
    activeRules: readonly RecurrenceRule[];
  },
): BookingWorkspaceDraft {
  const group = groupSchema.parse(input.group);
  requireOrganization(workspace, group.organizationId);
  const activeRules = input.activeRules.map((rule) =>
    recurrenceRuleSchema.parse({ ...rule, status: "active" }),
  );
  const activeRuleIds = new Set<string>();
  for (const rule of activeRules) {
    requireOrganization(workspace, rule.organizationId);
    if (rule.groupId !== group.id) {
      throw new BookingEntityMutationError(
        `Recurrence rule ${rule.id} belongs to another group`,
      );
    }
    if (activeRuleIds.has(rule.id)) {
      throw new BookingEntityMutationError(
        `Duplicate recurrence rule ${rule.id}`,
      );
    }
    activeRuleIds.add(rule.id);
    const existing = workspace.recurrenceRules.find(
      (candidate) => candidate.id === rule.id,
    );
    if (existing && existing.groupId !== group.id) {
      throw new BookingEntityMutationError(
        `Recurrence rule id ${rule.id} is already in use`,
      );
    }
    const orphanedBooking = workspace.bookings.find(
      (booking) =>
        booking.lessonRef.recurrenceRuleId === rule.id &&
        !isRecurrenceRuleOccurrence(rule, booking.lessonRef.originalDate),
    );
    if (orphanedBooking) {
      throw new BookingEntityMutationError(
        `Recurrence rule ${rule.id} cannot exclude booked occurrence ${orphanedBooking.lessonRef.originalDate}`,
      );
    }
  }

  for (const enrollment of workspace.enrollments) {
    if (
      enrollment.status !== "active" ||
      enrollment.assignmentState !== "configured" ||
      enrollment.groupId !== group.id
    ) {
      continue;
    }
    for (const selection of enrollment.weeklyScheduleSelections) {
      const replacement = activeRules.find(
        (rule) => rule.id === selection.recurrenceRuleId,
      );
      if (!replacement || !replacement.weekdays.includes(selection.weekday)) {
        throw new BookingEntityMutationError(
          `Recurrence rule ${selection.recurrenceRuleId} cannot remove ${selection.weekday} used by active enrollment ${enrollment.id}`,
        );
      }
    }
  }

  const ruleById = new Map(activeRules.map((rule) => [rule.id, rule]));
  const existingRuleIds = new Set(
    workspace.recurrenceRules.map((rule) => rule.id),
  );
  const recurrenceRules: RecurrenceRule[] = workspace.recurrenceRules.map(
    (rule): RecurrenceRule => {
      if (rule.groupId !== group.id) return rule;
      const replacement = ruleById.get(rule.id);
      if (replacement) return replacement;
      return rule.status === "active" ? { ...rule, status: "archived" } : rule;
    },
  );
  for (const rule of activeRules) {
    if (!existingRuleIds.has(rule.id)) recurrenceRules.push(rule);
  }

  const exists = workspace.groups.some(
    (candidate) => candidate.id === group.id,
  );
  return {
    ...workspaceDraft(workspace),
    groups: exists
      ? workspace.groups.map((candidate) =>
          candidate.id === group.id ? group : candidate,
        )
      : [...workspace.groups, group],
    recurrenceRules,
  };
}

export function setBookingGroupStatus(
  workspace: BookingWorkspace,
  groupId: string,
  status: BookingGroup["status"],
): BookingWorkspaceDraft {
  if (!workspace.groups.some((group) => group.id === groupId)) {
    throw new BookingEntityMutationError(`Unknown group ${groupId}`);
  }
  return {
    ...workspaceDraft(workspace),
    groups: workspace.groups.map((group) =>
      group.id === groupId ? { ...group, status } : group,
    ),
  };
}

type LessonExceptionMutationInput = {
  id: string;
  recurrenceRuleId: string;
  originalDate: string;
  reason?: string;
} & (
  | { kind: "cancelled"; updatedAt: string }
  | {
      kind: "override";
      override: Extract<LessonException, { kind: "override" }>["override"];
    }
);

function lessonOriginal(
  workspace: BookingWorkspace,
  recurrenceRuleId: string,
  originalDate: string,
): LessonOriginal {
  const existing = workspace.lessonExceptions.find(
    (exception) =>
      exception.recurrenceRuleId === recurrenceRuleId &&
      exception.originalDate === originalDate,
  );
  if (existing) return existing.original;
  if (
    !materializeScheduleOccurrence(workspace, recurrenceRuleId, originalDate)
  ) {
    throw new BookingEntityMutationError(
      `Unknown lesson ${recurrenceRuleId}:${originalDate}`,
    );
  }
  const rule = workspace.recurrenceRules.find(
    (candidate) => candidate.id === recurrenceRuleId,
  );
  const group = rule
    ? workspace.groups.find((candidate) => candidate.id === rule.groupId)
    : undefined;
  if (!rule || !group) {
    throw new BookingEntityMutationError(
      `Unknown lesson ${recurrenceRuleId}:${originalDate}`,
    );
  }
  return {
    startTime: rule.startTime,
    endTime: rule.endTime,
    branchId: rule.branchIdOverride ?? group.branchId,
    roomId:
      rule.roomIdOverride !== undefined
        ? rule.roomIdOverride
        : (group.roomId ?? null),
    teacherIds: [...(rule.teacherIdsOverride ?? group.teacherIds)],
  };
}

function lessonEffective(
  workspace: BookingWorkspace,
  recurrenceRuleId: string,
  originalDate: string,
): LessonEffective {
  const occurrence = materializeScheduleOccurrence(
    workspace,
    recurrenceRuleId,
    originalDate,
  );
  if (!occurrence) {
    throw new BookingEntityMutationError(
      `Unknown lesson ${recurrenceRuleId}:${originalDate}`,
    );
  }
  return {
    date: occurrence.date,
    startTime: occurrence.startTime,
    endTime: occurrence.endTime,
    branchId: occurrence.branchId,
    roomId: occurrence.roomId ?? null,
    teacherIds: [...occurrence.teacherIds],
    capacity: occurrence.capacity ?? null,
    trialPolicy: occurrence.trialPolicy,
    allowSingleVisits: occurrence.singleVisitAllowed,
  };
}

export function upsertBookingLessonException(
  workspace: BookingWorkspace,
  input: LessonExceptionMutationInput,
): BookingWorkspaceDraft {
  const existingByKey = workspace.lessonExceptions.find(
    (exception) =>
      exception.recurrenceRuleId === input.recurrenceRuleId &&
      exception.originalDate === input.originalDate,
  );
  const existingById = workspace.lessonExceptions.find(
    (exception) => exception.id === input.id,
  );
  if (
    (existingByKey && existingByKey.id !== input.id) ||
    (existingById &&
      (existingById.recurrenceRuleId !== input.recurrenceRuleId ||
        existingById.originalDate !== input.originalDate))
  ) {
    throw new BookingEntityMutationError(
      `Lesson exception id or occurrence is already in use`,
    );
  }
  const exception = lessonExceptionSchema.parse({
    ...input,
    organizationId: workspace.organization.id,
    original: lessonOriginal(
      workspace,
      input.recurrenceRuleId,
      input.originalDate,
    ),
    ...(input.kind === "cancelled"
      ? {
          effective: lessonEffective(
            workspace,
            input.recurrenceRuleId,
            input.originalDate,
          ),
        }
      : {}),
  });
  const lessonRef = {
    recurrenceRuleId: input.recurrenceRuleId,
    originalDate: input.originalDate,
  };
  return {
    ...workspaceDraft(workspace),
    lessonExceptions: existingByKey
      ? workspace.lessonExceptions.map((candidate) =>
          candidate.id === existingByKey.id ? exception : candidate,
        )
      : [...workspace.lessonExceptions, exception],
    bookings:
      input.kind === "cancelled"
        ? workspace.bookings.map((booking) =>
            stableLessonReferenceKey(booking.lessonRef) ===
              stableLessonReferenceKey(lessonRef) &&
            (booking.status === "pending_confirmation" ||
              booking.status === "confirmed")
              ? transitionBookingStatus(
                  booking,
                  "cancelled_by_center",
                  input.updatedAt,
                )
              : booking,
          )
        : workspace.bookings,
  };
}

export function restoreBookingLessonToSeries(
  workspace: BookingWorkspace,
  recurrenceRuleId: string,
  originalDate: string,
): BookingWorkspaceDraft {
  if (
    !materializeScheduleOccurrence(workspace, recurrenceRuleId, originalDate)
  ) {
    throw new BookingEntityMutationError(
      `Unknown lesson ${recurrenceRuleId}:${originalDate}`,
    );
  }
  return {
    ...workspaceDraft(workspace),
    lessonExceptions: workspace.lessonExceptions.filter(
      (exception) =>
        exception.recurrenceRuleId !== recurrenceRuleId ||
        exception.originalDate !== originalDate,
    ),
  };
}
