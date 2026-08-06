import type {
  BookingAttendanceRecord,
  BookingEnrollment,
  BookingWorkspace,
  StableLessonReference,
  Weekday,
} from "@/features/booking/model/bookingCore";
import {
  bookingHoldsLessonSeat,
  stableLessonReferenceKey,
} from "@/features/booking/model/publicBooking";

export function resolveSingleVisitAllowed(
  workspace: BookingWorkspace,
  lessonRef: StableLessonReference,
): boolean {
  const rule = workspace.recurrenceRules.find(
    (candidate) => candidate.id === lessonRef.recurrenceRuleId,
  );
  const group = rule
    ? workspace.groups.find((candidate) => candidate.id === rule.groupId)
    : undefined;
  if (!rule || !group) return false;
  const exception = workspace.lessonExceptions.find(
    (candidate) =>
      candidate.recurrenceRuleId === lessonRef.recurrenceRuleId &&
      candidate.originalDate === lessonRef.originalDate,
  );
  const lessonOverride =
    exception?.kind === "override"
      ? exception.override.allowSingleVisits
      : exception?.effective?.allowSingleVisits;
  return (
    lessonOverride ??
    group.allowSingleVisitsOverride ??
    workspace.organization.allowSingleVisitsByDefault
  );
}

export function resolveAttendanceTracking(
  workspace: BookingWorkspace,
  groupId: string,
): boolean {
  const group = workspace.groups.find((candidate) => candidate.id === groupId);
  return (
    group?.trackAttendanceOverride ??
    workspace.organization.trackAttendanceByDefault
  );
}

export function isEnrollmentActiveOn(
  enrollment: BookingEnrollment,
  date: string,
): boolean {
  return (
    enrollment.status === "active" &&
    enrollment.startDate <= date &&
    (enrollment.endDate === undefined || enrollment.endDate >= date)
  );
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

export function enrollmentCoversLesson(
  enrollment: BookingEnrollment,
  lesson: {
    groupId: string;
    date: string;
    lessonRef: StableLessonReference;
  },
): boolean {
  if (
    enrollment.groupId !== lesson.groupId ||
    !isEnrollmentActiveOn(enrollment, lesson.date)
  ) {
    return false;
  }
  if (enrollment.assignmentState === "needs_assignment") return true;
  const originalWeekday = weekdayForIsoDate(lesson.lessonRef.originalDate);
  return enrollment.weeklyScheduleSelections.some(
    (selection) =>
      selection.recurrenceRuleId === lesson.lessonRef.recurrenceRuleId &&
      selection.weekday === originalWeekday,
  );
}

export function lessonParticipantChildIds(
  workspace: BookingWorkspace,
  lesson: {
    groupId: string;
    date: string;
    lessonRef: StableLessonReference;
  },
): ReadonlySet<string> {
  const childIds = new Set(
    workspace.enrollments
      .filter((enrollment) => enrollmentCoversLesson(enrollment, lesson))
      .map((enrollment) => enrollment.childId),
  );
  for (const booking of workspace.bookings) {
    if (bookingHoldsLessonSeat(booking, lesson.lessonRef)) {
      childIds.add(booking.childId);
    }
  }
  return childIds;
}

export function lessonOccupancy(
  workspace: BookingWorkspace,
  lesson: {
    groupId: string;
    date: string;
    lessonRef: StableLessonReference;
  },
): number {
  return lessonParticipantChildIds(workspace, lesson).size;
}

export function attendanceForLesson(
  workspace: BookingWorkspace,
  lessonRef: StableLessonReference,
): ReadonlyMap<string, BookingAttendanceRecord> {
  const referenceKey = stableLessonReferenceKey(lessonRef);
  return new Map(
    workspace.attendanceRecords
      .filter(
        (record) => stableLessonReferenceKey(record.lessonRef) === referenceKey,
      )
      .map((record) => [record.childId, record]),
  );
}
