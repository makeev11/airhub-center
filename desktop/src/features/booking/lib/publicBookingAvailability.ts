import {
  organizationLocalDateTime,
  shiftBookingIsoDate,
} from "@/features/booking/lib/bookingDateTime";
import type {
  BookingWorkspace,
  PublicBookingPurpose,
  PublicLessonBooking,
  StableLessonReference,
  TrialPolicy,
} from "@/features/booking/model/bookingCore";
import {
  bookingHoldsLessonSeat,
  isBirthMonthPotentiallyEligible,
  isCompletedAgePotentiallyEligible,
} from "@/features/booking/model/publicBooking";
import { lessonOccupancy } from "@/features/booking/model/bookingOperations";
import {
  materializeSchedule,
  materializeScheduleOccurrence,
  type ScheduleOccurrence,
} from "@/features/booking/model/materializeSchedule";

export type PublicOccurrenceSearchFilters = {
  branchId?: string;
  groupId?: string;
  birthYear?: number;
  birthMonth?: number;
  ageYears?: number;
  purpose?: PublicBookingPurpose;
};

export type PublicBookingOccurrence = {
  lessonRef: StableLessonReference;
  groupId: string;
  groupName: string;
  groupDescription?: string;
  minAgeMonths?: number;
  maxAgeMonths?: number;
  branchId: string;
  branchName: string;
  branchAddress: string;
  roomName?: string;
  teacherNames: string[];
  date: string;
  startTime: string;
  endTime: string;
  trialPolicy: TrialPolicy;
  capacity: number | null;
  occupied: number;
  remaining: number | null;
  available: boolean;
};

export type FindPublicBookingOccurrencesOptions = {
  now: Date;
  horizonDays?: number;
  includeFull?: boolean;
};

/** Returns whether an occurrence has not started in organization-local time. */
export function isFuturePublicOccurrence(
  workspace: Pick<BookingWorkspace, "organization">,
  occurrence: Pick<ScheduleOccurrence, "date" | "startTime">,
  now: Date,
): boolean {
  const local = organizationLocalDateTime(workspace.organization.timeZone, now);
  return (
    occurrence.date > local.date ||
    (occurrence.date === local.date && occurrence.startTime > local.time)
  );
}

/** Returns whether a booking currently consumes a seat on its stable lesson. */
export function bookingOccupiesPublicSeat(
  booking: PublicLessonBooking,
  occurrence: ScheduleOccurrence,
  workspace: Pick<BookingWorkspace, "organization">,
  now: Date,
): boolean {
  if (
    !bookingHoldsLessonSeat(booking, {
      recurrenceRuleId: occurrence.recurrenceRuleId,
      originalDate: occurrence.originalDate,
    })
  ) {
    return false;
  }
  return isFuturePublicOccurrence(workspace, occurrence, now);
}

/** Counts capacity-holding bookings for a concrete stable occurrence. */
export function publicOccurrenceOccupancy(
  workspace: BookingWorkspace,
  occurrence: ScheduleOccurrence,
  now: Date,
): number {
  if (!isFuturePublicOccurrence(workspace, occurrence, now)) return 0;
  return lessonOccupancy(workspace, {
    groupId: occurrence.groupId,
    date: occurrence.date,
    lessonRef: {
      recurrenceRuleId: occurrence.recurrenceRuleId,
      originalDate: occurrence.originalDate,
    },
  });
}

function publicOccurrencePresentation(
  workspace: BookingWorkspace,
  occurrence: ScheduleOccurrence,
  now: Date,
  purpose: PublicBookingPurpose,
): PublicBookingOccurrence | null {
  const rule = workspace.recurrenceRules.find(
    (candidate) => candidate.id === occurrence.recurrenceRuleId,
  );
  const group = workspace.groups.find(
    (candidate) => candidate.id === occurrence.groupId,
  );
  const branch = workspace.branches.find(
    (candidate) => candidate.id === occurrence.branchId,
  );
  if (
    rule?.status !== "active" ||
    !group ||
    group.status !== "active" ||
    !branch ||
    branch.status !== "active" ||
    occurrence.status === "cancelled" ||
    (purpose === "trial" && occurrence.trialPolicy.mode === "disabled") ||
    !isFuturePublicOccurrence(workspace, occurrence, now)
  ) {
    return null;
  }

  const occupied = publicOccurrenceOccupancy(workspace, occurrence, now);
  const capacity = occurrence.capacity ?? null;
  const remaining = capacity === null ? null : Math.max(capacity - occupied, 0);
  const teacherById = new Map(
    workspace.teachers.map((teacher) => [teacher.id, teacher]),
  );
  const room = occurrence.roomId
    ? workspace.rooms.find((candidate) => candidate.id === occurrence.roomId)
    : undefined;

  return {
    lessonRef: {
      recurrenceRuleId: occurrence.recurrenceRuleId,
      originalDate: occurrence.originalDate,
    },
    groupId: group.id,
    groupName: group.name,
    ...(group.description ? { groupDescription: group.description } : {}),
    ...(group.minAgeMonths === undefined
      ? {}
      : { minAgeMonths: group.minAgeMonths }),
    ...(group.maxAgeMonths === undefined
      ? {}
      : { maxAgeMonths: group.maxAgeMonths }),
    branchId: branch.id,
    branchName: branch.name,
    branchAddress: branch.address,
    ...(room ? { roomName: room.name } : {}),
    teacherNames: occurrence.teacherIds
      .map((teacherId) => teacherById.get(teacherId)?.displayName)
      .filter((name): name is string => Boolean(name)),
    date: occurrence.date,
    startTime: occurrence.startTime,
    endTime: occurrence.endTime,
    trialPolicy: occurrence.trialPolicy,
    capacity,
    occupied,
    remaining,
    available: remaining === null || remaining > 0,
  };
}

/**
 * Materializes the public catalog from Booking Core, applying activity,
 * trial, age, future-time and capacity rules in one pure query.
 */
export function findPublicBookingOccurrences(
  workspace: BookingWorkspace,
  filters: PublicOccurrenceSearchFilters,
  options: FindPublicBookingOccurrencesOptions,
): PublicBookingOccurrence[] {
  const purpose = filters.purpose ?? "trial";
  const local = organizationLocalDateTime(
    workspace.organization.timeZone,
    options.now,
  );
  const occurrences = materializeSchedule(workspace, {
    startsOn: local.date,
    endsOn: shiftBookingIsoDate(local.date, options.horizonDays ?? 120),
  });

  return occurrences
    .map((occurrence) =>
      publicOccurrencePresentation(workspace, occurrence, options.now, purpose),
    )
    .filter((value): value is PublicBookingOccurrence => Boolean(value))
    .filter(
      (occurrence) =>
        (!filters.branchId || occurrence.branchId === filters.branchId) &&
        (!filters.groupId || occurrence.groupId === filters.groupId),
    )
    .filter((occurrence) => {
      if (filters.ageYears !== undefined) {
        return isCompletedAgePotentiallyEligible(
          occurrence,
          filters.ageYears,
          local.date,
          occurrence.date,
        );
      }
      if (filters.birthYear === undefined || filters.birthMonth === undefined) {
        return true;
      }
      return isBirthMonthPotentiallyEligible(
        occurrence,
        filters.birthYear,
        filters.birthMonth,
        occurrence.date,
      );
    })
    .filter(
      (occurrence) => options.includeFull !== false || occurrence.available,
    );
}

/** Resolves a stable lesson reference even after move, cancel or revert. */
export function resolveStablePublicOccurrence(
  workspace: BookingWorkspace,
  lessonRef: StableLessonReference,
): ScheduleOccurrence | null {
  return materializeScheduleOccurrence(
    workspace,
    lessonRef.recurrenceRuleId,
    lessonRef.originalDate,
  );
}
