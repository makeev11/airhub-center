import {
  isRecurrenceRuleOccurrence,
  weekdayForIsoDate,
} from "@/features/booking/model/bookingRecurrence";
import type {
  BookingWorkspace,
  StableLessonReference,
} from "@/features/booking/model/bookingCore";
import {
  duplicateIdIssues,
  validateBookingOperationalReferences,
  type BookingValidationIssue,
} from "@/features/booking/model/bookingOperationalValidation";

export function validateBookingWorkspaceReferences(
  workspace: BookingWorkspace,
): BookingValidationIssue[] {
  const issues = [
    ...duplicateIdIssues("branches", workspace.branches),
    ...duplicateIdIssues("rooms", workspace.rooms),
    ...duplicateIdIssues("teachers", workspace.teachers),
    ...duplicateIdIssues("groups", workspace.groups),
    ...duplicateIdIssues("recurrenceRules", workspace.recurrenceRules),
    ...duplicateIdIssues("lessonExceptions", workspace.lessonExceptions),
    ...duplicateIdIssues("families", workspace.families),
    ...duplicateIdIssues("representatives", workspace.representatives),
    ...duplicateIdIssues("children", workspace.children),
    ...duplicateIdIssues("duplicateCandidates", workspace.duplicateCandidates),
    ...duplicateIdIssues("bookings", workspace.bookings),
    ...duplicateIdIssues("tariffs", workspace.tariffs),
    ...duplicateIdIssues("enrollments", workspace.enrollments),
    ...duplicateIdIssues("paymentExpectations", workspace.paymentExpectations),
    ...duplicateIdIssues("intakeRequests", workspace.intakeRequests),
    ...duplicateIdIssues("pendingActions", workspace.pendingActions),
    ...duplicateIdIssues("attendanceRecords", workspace.attendanceRecords),
  ];
  const organizationId = workspace.organization.id;
  const branchById = new Map(
    workspace.branches.map((branch) => [branch.id, branch]),
  );
  const roomById = new Map(workspace.rooms.map((room) => [room.id, room]));
  const teacherIds = new Set(workspace.teachers.map((teacher) => teacher.id));
  const groupById = new Map(workspace.groups.map((group) => [group.id, group]));
  const ruleById = new Map(
    workspace.recurrenceRules.map((rule) => [rule.id, rule]),
  );
  const familyById = new Map(
    workspace.families.map((family) => [family.id, family]),
  );
  const representativeById = new Map(
    workspace.representatives.map((representative) => [
      representative.id,
      representative,
    ]),
  );
  const childById = new Map(
    workspace.children.map((child) => [child.id, child]),
  );

  const requireOrganization = (path: string, value: string) => {
    if (value !== organizationId) {
      issues.push({ path, message: `Unknown organization ${value}` });
    }
  };
  const requireTeachers = (path: string, values: readonly string[]) => {
    for (const teacherId of values) {
      if (!teacherIds.has(teacherId)) {
        issues.push({ path, message: `Unknown teacher ${teacherId}` });
      }
    }
  };
  const requireLessonReference = (
    path: string,
    lessonRef: StableLessonReference,
  ) => {
    const rule = ruleById.get(lessonRef.recurrenceRuleId);
    if (!rule) {
      issues.push({
        path: `${path}.recurrenceRuleId`,
        message: `Unknown recurrence rule ${lessonRef.recurrenceRuleId}`,
      });
      return;
    }
    if (!isRecurrenceRuleOccurrence(rule, lessonRef.originalDate)) {
      issues.push({
        path: `${path}.originalDate`,
        message: "Date is not an occurrence of the recurrence rule",
      });
    }
  };

  for (const branch of workspace.branches) {
    requireOrganization(
      `branches.${branch.id}.organizationId`,
      branch.organizationId,
    );
  }
  for (const room of workspace.rooms) {
    requireOrganization(`rooms.${room.id}.organizationId`, room.organizationId);
    if (!branchById.has(room.branchId)) {
      issues.push({
        path: `rooms.${room.id}.branchId`,
        message: `Unknown branch ${room.branchId}`,
      });
    }
  }
  for (const teacher of workspace.teachers) {
    requireOrganization(
      `teachers.${teacher.id}.organizationId`,
      teacher.organizationId,
    );
  }
  for (const family of workspace.families) {
    requireOrganization(
      `families.${family.id}.organizationId`,
      family.organizationId,
    );
    const primaryRepresentative = representativeById.get(
      family.primaryRepresentativeId,
    );
    if (!primaryRepresentative) {
      issues.push({
        path: `families.${family.id}.primaryRepresentativeId`,
        message: `Unknown representative ${family.primaryRepresentativeId}`,
      });
    } else if (primaryRepresentative.familyId !== family.id) {
      issues.push({
        path: `families.${family.id}.primaryRepresentativeId`,
        message: `Representative ${primaryRepresentative.id} does not belong to family ${family.id}`,
      });
    }
  }
  for (const representative of workspace.representatives) {
    requireOrganization(
      `representatives.${representative.id}.organizationId`,
      representative.organizationId,
    );
    if (!familyById.has(representative.familyId)) {
      issues.push({
        path: `representatives.${representative.id}.familyId`,
        message: `Unknown family ${representative.familyId}`,
      });
    }
  }
  for (const child of workspace.children) {
    requireOrganization(
      `children.${child.id}.organizationId`,
      child.organizationId,
    );
    if (!familyById.has(child.familyId)) {
      issues.push({
        path: `children.${child.id}.familyId`,
        message: `Unknown family ${child.familyId}`,
      });
    }
  }
  for (const candidate of workspace.duplicateCandidates) {
    requireOrganization(
      `duplicateCandidates.${candidate.id}.organizationId`,
      candidate.organizationId,
    );
    const newEntity =
      candidate.newEntityType === "representative"
        ? representativeById.get(candidate.newEntityId)
        : childById.get(candidate.newEntityId);
    const existingEntity =
      candidate.existingEntityType === "representative"
        ? representativeById.get(candidate.existingEntityId)
        : childById.get(candidate.existingEntityId);
    if (!newEntity) {
      issues.push({
        path: `duplicateCandidates.${candidate.id}.newEntityId`,
        message: `Unknown ${candidate.newEntityType} ${candidate.newEntityId}`,
      });
    }
    if (!existingEntity) {
      issues.push({
        path: `duplicateCandidates.${candidate.id}.existingEntityId`,
        message: `Unknown ${candidate.existingEntityType} ${candidate.existingEntityId}`,
      });
    }
  }
  for (const group of workspace.groups) {
    requireOrganization(
      `groups.${group.id}.organizationId`,
      group.organizationId,
    );
    if (!branchById.has(group.branchId)) {
      issues.push({
        path: `groups.${group.id}.branchId`,
        message: `Unknown branch ${group.branchId}`,
      });
    }
    if (group.roomId) {
      const room = roomById.get(group.roomId);
      if (!room || room.branchId !== group.branchId) {
        issues.push({
          path: `groups.${group.id}.roomId`,
          message: `Room ${group.roomId} is not in branch ${group.branchId}`,
        });
      }
    }
    requireTeachers(`groups.${group.id}.teacherIds`, group.teacherIds);
  }
  for (const rule of workspace.recurrenceRules) {
    requireOrganization(
      `recurrenceRules.${rule.id}.organizationId`,
      rule.organizationId,
    );
    const group = groupById.get(rule.groupId);
    if (!group) {
      issues.push({
        path: `recurrenceRules.${rule.id}.groupId`,
        message: `Unknown group ${rule.groupId}`,
      });
      continue;
    }
    const branchId = rule.branchIdOverride ?? group.branchId;
    if (!branchById.has(branchId)) {
      issues.push({
        path: `recurrenceRules.${rule.id}.branchIdOverride`,
        message: `Unknown branch ${branchId}`,
      });
    }
    const roomId = rule.roomIdOverride ?? group.roomId;
    if (roomId) {
      const room = roomById.get(roomId);
      if (!room || room.branchId !== branchId) {
        issues.push({
          path: `recurrenceRules.${rule.id}.roomIdOverride`,
          message: `Room ${roomId} is not in branch ${branchId}`,
        });
      }
    }
    requireTeachers(
      `recurrenceRules.${rule.id}.teacherIdsOverride`,
      rule.teacherIdsOverride ?? group.teacherIds,
    );
  }

  const exceptionKeys = new Set<string>();
  for (const exception of workspace.lessonExceptions) {
    requireOrganization(
      `lessonExceptions.${exception.id}.organizationId`,
      exception.organizationId,
    );
    const rule = ruleById.get(exception.recurrenceRuleId);
    if (!rule) {
      issues.push({
        path: `lessonExceptions.${exception.id}.recurrenceRuleId`,
        message: `Unknown recurrence rule ${exception.recurrenceRuleId}`,
      });
      continue;
    }
    const key = `${exception.recurrenceRuleId}:${exception.originalDate}`;
    if (exceptionKeys.has(key)) {
      issues.push({
        path: `lessonExceptions.${exception.id}`,
        message: `Duplicate exception for ${key}`,
      });
    }
    exceptionKeys.add(key);
    if (
      exception.originalDate < rule.startsOn ||
      exception.originalDate > rule.endsOn
    ) {
      issues.push({
        path: `lessonExceptions.${exception.id}.originalDate`,
        message: "Exception date is outside recurrence range",
      });
    }
    if (!rule.weekdays.includes(weekdayForIsoDate(exception.originalDate))) {
      issues.push({
        path: `lessonExceptions.${exception.id}.originalDate`,
        message: "Exception date is not an occurrence of the recurrence rule",
      });
    }
    const originalBranch = branchById.get(exception.original.branchId);
    if (!originalBranch) {
      issues.push({
        path: `lessonExceptions.${exception.id}.original.branchId`,
        message: `Unknown branch ${exception.original.branchId}`,
      });
    }
    if (exception.original.roomId) {
      const originalRoom = roomById.get(exception.original.roomId);
      if (
        !originalRoom ||
        originalRoom.branchId !== exception.original.branchId
      ) {
        issues.push({
          path: `lessonExceptions.${exception.id}.original.roomId`,
          message: `Room ${exception.original.roomId} is not in branch ${exception.original.branchId}`,
        });
      }
    }
    requireTeachers(
      `lessonExceptions.${exception.id}.original.teacherIds`,
      exception.original.teacherIds,
    );
    const occurrenceChange =
      exception.kind === "override" ? exception.override : exception.effective;
    if (!occurrenceChange) continue;
    const occurrenceChangePath =
      exception.kind === "override" ? "override" : "effective";
    const group = groupById.get(rule.groupId);
    if (!group) continue;
    const branchId =
      occurrenceChange.branchId ?? rule.branchIdOverride ?? group.branchId;
    if (!branchById.has(branchId)) {
      issues.push({
        path: `lessonExceptions.${exception.id}.${occurrenceChangePath}.branchId`,
        message: `Unknown branch ${branchId}`,
      });
    }
    const roomId =
      occurrenceChange.roomId !== undefined
        ? occurrenceChange.roomId
        : rule.roomIdOverride !== undefined
          ? rule.roomIdOverride
          : group.roomId;
    if (roomId) {
      const room = roomById.get(roomId);
      if (!room || room.branchId !== branchId) {
        issues.push({
          path: `lessonExceptions.${exception.id}.${occurrenceChangePath}.roomId`,
          message: `Room ${roomId} is not in branch ${branchId}`,
        });
      }
    }
    requireTeachers(
      `lessonExceptions.${exception.id}.${occurrenceChangePath}.teacherIds`,
      occurrenceChange.teacherIds ??
        rule.teacherIdsOverride ??
        group.teacherIds,
    );
    const startTime = occurrenceChange.startTime ?? rule.startTime;
    const endTime = occurrenceChange.endTime ?? rule.endTime;
    if (startTime >= endTime) {
      issues.push({
        path: `lessonExceptions.${exception.id}.${occurrenceChangePath}`,
        message: "Overridden lesson must end after it starts",
      });
    }
  }

  const managementTokenDigests = new Set<string>();
  const idempotencyKeyDigests = new Set<string>();
  for (const booking of workspace.bookings) {
    requireOrganization(
      `bookings.${booking.id}.organizationId`,
      booking.organizationId,
    );
    const family = familyById.get(booking.familyId);
    const representative = representativeById.get(booking.representativeId);
    const child = childById.get(booking.childId);
    if (!family) {
      issues.push({
        path: `bookings.${booking.id}.familyId`,
        message: `Unknown family ${booking.familyId}`,
      });
    }
    if (!representative) {
      issues.push({
        path: `bookings.${booking.id}.representativeId`,
        message: `Unknown representative ${booking.representativeId}`,
      });
    } else if (representative.familyId !== booking.familyId) {
      issues.push({
        path: `bookings.${booking.id}.representativeId`,
        message: `Representative ${representative.id} does not belong to family ${booking.familyId}`,
      });
    }
    if (!child) {
      issues.push({
        path: `bookings.${booking.id}.childId`,
        message: `Unknown child ${booking.childId}`,
      });
    } else if (child.familyId !== booking.familyId) {
      issues.push({
        path: `bookings.${booking.id}.childId`,
        message: `Child ${child.id} does not belong to family ${booking.familyId}`,
      });
    }
    requireLessonReference(
      `bookings.${booking.id}.lessonRef`,
      booking.lessonRef,
    );
    if (managementTokenDigests.has(booking.managementTokenDigest)) {
      issues.push({
        path: `bookings.${booking.id}.managementTokenDigest`,
        message: "Duplicate management token digest",
      });
    }
    managementTokenDigests.add(booking.managementTokenDigest);
    if (idempotencyKeyDigests.has(booking.idempotencyKeyDigest)) {
      issues.push({
        path: `bookings.${booking.id}.idempotencyKeyDigest`,
        message: "Duplicate booking idempotency digest",
      });
    }
    idempotencyKeyDigests.add(booking.idempotencyKeyDigest);
  }

  return [...issues, ...validateBookingOperationalReferences(workspace)];
}
