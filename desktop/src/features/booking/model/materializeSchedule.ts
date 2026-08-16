import type {
  BookingGroup,
  BookingWorkspace,
  LessonException,
  RecurrenceRule,
  TrialPolicy,
  Weekday,
} from "@/features/booking/model/bookingCore";
import {
  resolveAttendanceTracking,
  resolveSingleVisitAllowed,
} from "@/features/booking/model/bookingOperations";

const WEEKDAYS: readonly Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export type ScheduleOccurrence = {
  id: string;
  organizationId: string;
  recurrenceRuleId: string;
  groupId: string;
  branchId: string;
  roomId?: string;
  teacherIds: string[];
  originalDate: string;
  originalStartTime: string;
  originalEndTime: string;
  date: string;
  startTime: string;
  endTime: string;
  capacity?: number;
  trialPolicy: TrialPolicy;
  singleVisitAllowed: boolean;
  trackAttendance: boolean;
  status: "scheduled" | "moved" | "modified" | "cancelled";
  exceptionId?: string;
};

export type ScheduleRange = {
  startsOn: string;
  endsOn: string;
};

export type MaterializeScheduleOptions = {
  /**
   * Archived groups and recurrence rules remain queryable for history, while
   * the operational schedule shows active series only.
   */
  includeArchived?: boolean;
};

function asUtcDate(isoDate: string): Date {
  return new Date(`${isoDate}T12:00:00Z`);
}

function shiftIsoDate(isoDate: string, days: number): string {
  const date = asUtcDate(isoDate);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function weekdayForDate(isoDate: string): Weekday {
  return WEEKDAYS[asUtcDate(isoDate).getUTCDay()];
}

function occurrenceKey(ruleId: string, originalDate: string): string {
  return `${ruleId}:${originalDate}`;
}

function isRuleOccurrence(rule: RecurrenceRule, date: string): boolean {
  return (
    date >= rule.startsOn &&
    date <= rule.endsOn &&
    rule.weekdays.includes(weekdayForDate(date))
  );
}

function resolveNullableOverride<T>(
  occurrenceValue: T | null | undefined,
  ruleValue: T | null | undefined,
  groupValue: T | undefined,
): T | undefined {
  if (occurrenceValue !== undefined) return occurrenceValue ?? undefined;
  if (ruleValue !== undefined) return ruleValue ?? undefined;
  return groupValue;
}

function materializeOccurrence({
  workspace,
  rule,
  group,
  originalDate,
  exception,
}: {
  workspace: BookingWorkspace;
  rule: RecurrenceRule;
  group: BookingGroup;
  originalDate: string;
  exception?: LessonException;
}): ScheduleOccurrence {
  const override =
    exception?.kind === "override" ? exception.override : undefined;
  const effective =
    exception?.kind === "cancelled" ? exception.effective : undefined;
  const originalStartTime = exception?.original.startTime ?? rule.startTime;
  const originalEndTime = exception?.original.endTime ?? rule.endTime;
  const date = effective?.date ?? override?.date ?? originalDate;
  const startTime =
    effective?.startTime ?? override?.startTime ?? rule.startTime;
  const endTime = effective?.endTime ?? override?.endTime ?? rule.endTime;
  const branchId =
    effective?.branchId ??
    override?.branchId ??
    rule.branchIdOverride ??
    group.branchId;
  const roomId = effective
    ? (effective.roomId ?? undefined)
    : resolveNullableOverride(
        override?.roomId,
        rule.roomIdOverride,
        group.roomId,
      );
  const teacherIds = [
    ...(effective?.teacherIds ??
      override?.teacherIds ??
      rule.teacherIdsOverride ??
      group.teacherIds),
  ];
  const capacity = effective
    ? (effective.capacity ?? undefined)
    : resolveNullableOverride(
        override?.capacity,
        rule.capacityOverride,
        group.capacity,
      );
  const trialPolicy =
    effective?.trialPolicy ??
    override?.trialPolicy ??
    rule.trialPolicyOverride ??
    group.trialPolicyOverride ??
    workspace.organization.defaultTrialPolicy;
  const moved =
    date !== originalDate ||
    startTime !== rule.startTime ||
    endTime !== rule.endTime;
  const status =
    exception?.kind === "cancelled"
      ? "cancelled"
      : moved
        ? "moved"
        : exception
          ? "modified"
          : "scheduled";

  return {
    id: occurrenceKey(rule.id, originalDate),
    organizationId: workspace.organization.id,
    recurrenceRuleId: rule.id,
    groupId: group.id,
    branchId,
    ...(roomId ? { roomId } : {}),
    teacherIds,
    originalDate,
    originalStartTime,
    originalEndTime,
    date,
    startTime,
    endTime,
    ...(capacity === undefined ? {} : { capacity }),
    trialPolicy,
    singleVisitAllowed: resolveSingleVisitAllowed(workspace, {
      recurrenceRuleId: rule.id,
      originalDate,
    }),
    trackAttendance: resolveAttendanceTracking(workspace, group.id),
    status,
    ...(exception ? { exceptionId: exception.id } : {}),
  };
}

export function materializeScheduleOccurrence(
  workspace: BookingWorkspace,
  recurrenceRuleId: string,
  originalDate: string,
): ScheduleOccurrence | null {
  const rule = workspace.recurrenceRules.find(
    (candidate) => candidate.id === recurrenceRuleId,
  );
  if (!rule || !isRuleOccurrence(rule, originalDate)) return null;
  const group = workspace.groups.find(
    (candidate) => candidate.id === rule.groupId,
  );
  if (!group) return null;
  const exception = workspace.lessonExceptions.find(
    (candidate) =>
      candidate.recurrenceRuleId === recurrenceRuleId &&
      candidate.originalDate === originalDate,
  );
  return materializeOccurrence({
    workspace,
    rule,
    group,
    originalDate,
    exception,
  });
}

export function materializeSchedule(
  workspace: BookingWorkspace,
  range: ScheduleRange,
  options: MaterializeScheduleOptions = {},
): ScheduleOccurrence[] {
  if (range.startsOn > range.endsOn) {
    throw new Error("Schedule range is reversed");
  }

  const groupById = new Map(workspace.groups.map((group) => [group.id, group]));
  const exceptionByOccurrence = new Map(
    workspace.lessonExceptions.map((exception) => [
      occurrenceKey(exception.recurrenceRuleId, exception.originalDate),
      exception,
    ]),
  );
  const exceptionsByRuleId = new Map<string, LessonException[]>();
  for (const exception of workspace.lessonExceptions) {
    const ruleExceptions = exceptionsByRuleId.get(exception.recurrenceRuleId);
    if (ruleExceptions) {
      ruleExceptions.push(exception);
    } else {
      exceptionsByRuleId.set(exception.recurrenceRuleId, [exception]);
    }
  }
  const occurrences = new Map<string, ScheduleOccurrence>();

  for (const rule of workspace.recurrenceRules) {
    const group = groupById.get(rule.groupId);
    if (!group) continue;
    if (
      !options.includeArchived &&
      (group.status !== "active" || rule.status !== "active")
    ) {
      continue;
    }
    const firstDate =
      rule.startsOn > range.startsOn ? rule.startsOn : range.startsOn;
    const lastDate = rule.endsOn < range.endsOn ? rule.endsOn : range.endsOn;

    for (let date = firstDate; date <= lastDate; date = shiftIsoDate(date, 1)) {
      if (!isRuleOccurrence(rule, date)) continue;
      const key = occurrenceKey(rule.id, date);
      occurrences.set(
        key,
        materializeOccurrence({
          workspace,
          rule,
          group,
          originalDate: date,
          exception: exceptionByOccurrence.get(key),
        }),
      );
    }

    for (const exception of exceptionsByRuleId.get(rule.id) ?? []) {
      const targetDate =
        exception.kind === "override"
          ? exception.override.date
          : exception.effective?.date;
      if (
        exception.recurrenceRuleId !== rule.id ||
        (exception.originalDate >= firstDate &&
          exception.originalDate <= lastDate) ||
        !targetDate ||
        targetDate < range.startsOn ||
        targetDate > range.endsOn ||
        !isRuleOccurrence(rule, exception.originalDate)
      ) {
        continue;
      }
      const key = occurrenceKey(rule.id, exception.originalDate);
      occurrences.set(
        key,
        materializeOccurrence({
          workspace,
          rule,
          group,
          originalDate: exception.originalDate,
          exception,
        }),
      );
    }
  }

  return [...occurrences.values()]
    .filter(
      (occurrence) =>
        occurrence.date >= range.startsOn && occurrence.date <= range.endsOn,
    )
    .sort(
      (left, right) =>
        left.date.localeCompare(right.date) ||
        left.startTime.localeCompare(right.startTime) ||
        left.id.localeCompare(right.id),
    );
}
