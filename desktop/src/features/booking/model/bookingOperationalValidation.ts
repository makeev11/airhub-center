import type {
  BookingWorkspace,
  StableLessonReference,
  Weekday,
} from "@/features/booking/model/bookingCore";

export type BookingValidationIssue = {
  path: string;
  message: string;
};

export class BookingWorkspaceValidationError extends Error {
  readonly issues: readonly BookingValidationIssue[];

  constructor(issues: readonly BookingValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
    this.name = "BookingWorkspaceValidationError";
    this.issues = issues;
  }
}

export function duplicateIdIssues(
  collectionName: string,
  values: ReadonlyArray<{ id: string }>,
): BookingValidationIssue[] {
  const seen = new Set<string>();
  const issues: BookingValidationIssue[] = [];
  for (const value of values) {
    if (seen.has(value.id)) {
      issues.push({
        path: `${collectionName}.${value.id}`,
        message: `Duplicate id ${value.id}`,
      });
    }
    seen.add(value.id);
  }
  return issues;
}

export function isValidLocale(value: string): boolean {
  try {
    return Intl.getCanonicalLocales(value).length === 1;
  } catch {
    return false;
  }
}

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

function weekdayForIsoDate(value: string): Weekday {
  const weekdays: readonly Weekday[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  return weekdays[new Date(`${value}T12:00:00Z`).getUTCDay()] ?? "monday";
}

export function validateBookingOperationalReferences(
  workspace: BookingWorkspace,
): BookingValidationIssue[] {
  const issues: BookingValidationIssue[] = [];
  const organizationId = workspace.organization.id;
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
  const branchIds = new Set(workspace.branches.map((branch) => branch.id));
  const groupIds = new Set(workspace.groups.map((group) => group.id));
  const tariffById = new Map(
    workspace.tariffs.map((tariff) => [tariff.id, tariff]),
  );
  const ruleById = new Map(
    workspace.recurrenceRules.map((rule) => [rule.id, rule]),
  );
  const bookingIds = new Set(workspace.bookings.map((booking) => booking.id));
  const enrollmentById = new Map(
    workspace.enrollments.map((enrollment) => [enrollment.id, enrollment]),
  );
  const requireOrganization = (path: string, value: string) => {
    if (value !== organizationId) {
      issues.push({ path, message: `Unknown organization ${value}` });
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
    if (
      lessonRef.originalDate < rule.startsOn ||
      lessonRef.originalDate > rule.endsOn ||
      !rule.weekdays.includes(weekdayForIsoDate(lessonRef.originalDate))
    ) {
      issues.push({
        path: `${path}.originalDate`,
        message: "Date is not an occurrence of the recurrence rule",
      });
    }
  };

  const enrollmentRanges = new Map<
    string,
    Array<{ id: string; startDate: string; endDate?: string }>
  >();
  for (const enrollment of workspace.enrollments) {
    requireOrganization(
      `enrollments.${enrollment.id}.organizationId`,
      enrollment.organizationId,
    );
    const family = familyById.get(enrollment.familyId);
    const child = childById.get(enrollment.childId);
    if (!family) {
      issues.push({
        path: `enrollments.${enrollment.id}.familyId`,
        message: `Unknown family ${enrollment.familyId}`,
      });
    }
    if (!child) {
      issues.push({
        path: `enrollments.${enrollment.id}.childId`,
        message: `Unknown child ${enrollment.childId}`,
      });
    } else if (child.familyId !== enrollment.familyId) {
      issues.push({
        path: `enrollments.${enrollment.id}.childId`,
        message: `Child ${child.id} does not belong to family ${enrollment.familyId}`,
      });
    }
    if (!groupIds.has(enrollment.groupId)) {
      issues.push({
        path: `enrollments.${enrollment.id}.groupId`,
        message: `Unknown group ${enrollment.groupId}`,
      });
    }
    if (enrollment.assignmentState === "configured") {
      const tariff = tariffById.get(enrollment.tariffId);
      if (!tariff) {
        issues.push({
          path: `enrollments.${enrollment.id}.tariffId`,
          message: `Unknown tariff ${enrollment.tariffId}`,
        });
      }
      if (
        enrollment.weeklyScheduleSelections.length >
        (tariff?.weeklyScheduleLimit ?? Number.POSITIVE_INFINITY)
      ) {
        issues.push({
          path: `enrollments.${enrollment.id}.weeklyScheduleSelections`,
          message: "Weekly schedule exceeds tariff limit",
        });
      }
      const selectionKeys = new Set<string>();
      for (const selection of enrollment.weeklyScheduleSelections) {
        const key = `${selection.recurrenceRuleId}:${selection.weekday}`;
        const rule = ruleById.get(selection.recurrenceRuleId);
        if (selectionKeys.has(key)) {
          issues.push({
            path: `enrollments.${enrollment.id}.weeklyScheduleSelections`,
            message: `Duplicate weekly selection ${key}`,
          });
        }
        selectionKeys.add(key);
        if (!rule || rule.groupId !== enrollment.groupId) {
          issues.push({
            path: `enrollments.${enrollment.id}.weeklyScheduleSelections`,
            message: `Unknown group recurrence rule ${selection.recurrenceRuleId}`,
          });
        } else if (!rule.weekdays.includes(selection.weekday)) {
          issues.push({
            path: `enrollments.${enrollment.id}.weeklyScheduleSelections`,
            message: `Weekday ${selection.weekday} is not in recurrence rule ${rule.id}`,
          });
        }
      }
    }
    if (enrollment.status !== "active") continue;
    const key = `${enrollment.childId}:${enrollment.groupId}`;
    const ranges = enrollmentRanges.get(key) ?? [];
    for (const range of ranges) {
      const leftOverlaps =
        range.endDate === undefined || range.endDate >= enrollment.startDate;
      const rightOverlaps =
        enrollment.endDate === undefined ||
        enrollment.endDate >= range.startDate;
      if (leftOverlaps && rightOverlaps) {
        issues.push({
          path: `enrollments.${enrollment.id}`,
          message: `Enrollment overlaps ${range.id}`,
        });
      }
    }
    ranges.push({
      id: enrollment.id,
      startDate: enrollment.startDate,
      ...(enrollment.endDate ? { endDate: enrollment.endDate } : {}),
    });
    enrollmentRanges.set(key, ranges);
  }

  for (const tariff of workspace.tariffs) {
    requireOrganization(
      `tariffs.${tariff.id}.organizationId`,
      tariff.organizationId,
    );
  }

  for (const payment of workspace.paymentExpectations) {
    requireOrganization(
      `paymentExpectations.${payment.id}.organizationId`,
      payment.organizationId,
    );
    const family = familyById.get(payment.familyId);
    const child = childById.get(payment.childId);
    const enrollment = enrollmentById.get(payment.enrollmentId);
    if (!family) {
      issues.push({
        path: `paymentExpectations.${payment.id}.familyId`,
        message: `Unknown family ${payment.familyId}`,
      });
    }
    if (!child || child.familyId !== payment.familyId) {
      issues.push({
        path: `paymentExpectations.${payment.id}.childId`,
        message: `Unknown child ${payment.childId} in family ${payment.familyId}`,
      });
    }
    if (!tariffById.has(payment.tariffId)) {
      issues.push({
        path: `paymentExpectations.${payment.id}.tariffId`,
        message: `Unknown tariff ${payment.tariffId}`,
      });
    }
    if (!enrollment) {
      issues.push({
        path: `paymentExpectations.${payment.id}.enrollmentId`,
        message: `Unknown enrollment ${payment.enrollmentId}`,
      });
    } else if (
      enrollment.familyId !== payment.familyId ||
      enrollment.childId !== payment.childId ||
      enrollment.assignmentState !== "configured" ||
      enrollment.tariffId !== payment.tariffId
    ) {
      issues.push({
        path: `paymentExpectations.${payment.id}.enrollmentId`,
        message: `Payment does not belong to enrollment ${payment.enrollmentId}`,
      });
    }
  }

  for (const request of workspace.intakeRequests) {
    requireOrganization(
      `intakeRequests.${request.id}.organizationId`,
      request.organizationId,
    );
    const family = familyById.get(request.familyId);
    const representative = representativeById.get(request.representativeId);
    const child = childById.get(request.childId);
    if (!family) {
      issues.push({
        path: `intakeRequests.${request.id}.familyId`,
        message: `Unknown family ${request.familyId}`,
      });
    }
    if (!representative) {
      issues.push({
        path: `intakeRequests.${request.id}.representativeId`,
        message: `Unknown representative ${request.representativeId}`,
      });
    } else if (representative.familyId !== request.familyId) {
      issues.push({
        path: `intakeRequests.${request.id}.representativeId`,
        message: `Representative ${representative.id} does not belong to family ${request.familyId}`,
      });
    }
    if (!child) {
      issues.push({
        path: `intakeRequests.${request.id}.childId`,
        message: `Unknown child ${request.childId}`,
      });
    } else if (child.familyId !== request.familyId) {
      issues.push({
        path: `intakeRequests.${request.id}.childId`,
        message: `Child ${child.id} does not belong to family ${request.familyId}`,
      });
    }
    if (request.branchId && !branchIds.has(request.branchId)) {
      issues.push({
        path: `intakeRequests.${request.id}.branchId`,
        message: `Unknown branch ${request.branchId}`,
      });
    }
    if (request.groupId && !groupIds.has(request.groupId)) {
      issues.push({
        path: `intakeRequests.${request.id}.groupId`,
        message: `Unknown group ${request.groupId}`,
      });
    }
    if (request.bookingId && !bookingIds.has(request.bookingId)) {
      issues.push({
        path: `intakeRequests.${request.id}.bookingId`,
        message: `Unknown booking ${request.bookingId}`,
      });
    }
  }

  for (const action of workspace.pendingActions) {
    requireOrganization(
      `pendingActions.${action.id}.organizationId`,
      action.organizationId,
    );
  }

  const attendanceKeys = new Set<string>();
  for (const attendance of workspace.attendanceRecords) {
    requireOrganization(
      `attendanceRecords.${attendance.id}.organizationId`,
      attendance.organizationId,
    );
    if (!childById.has(attendance.childId)) {
      issues.push({
        path: `attendanceRecords.${attendance.id}.childId`,
        message: `Unknown child ${attendance.childId}`,
      });
    }
    requireLessonReference(
      `attendanceRecords.${attendance.id}.lessonRef`,
      attendance.lessonRef,
    );
    const key = `${attendance.childId}:${attendance.lessonRef.recurrenceRuleId}:${attendance.lessonRef.originalDate}`;
    if (attendanceKeys.has(key)) {
      issues.push({
        path: `attendanceRecords.${attendance.id}`,
        message: `Duplicate attendance for ${key}`,
      });
    }
    attendanceKeys.add(key);
  }
  return issues;
}
