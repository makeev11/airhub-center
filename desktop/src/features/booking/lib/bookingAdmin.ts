import type {
  BookingGroup,
  BookingRoom,
  BookingWorkspace,
  RecurrenceRule,
  TrialPolicy,
  Weekday,
  WeeklyWorkingHours,
  WorkingPeriod,
} from "@/features/booking/model/bookingCore";
import {
  materializeSchedule,
  materializeScheduleOccurrence,
} from "@/features/booking/model/materializeSchedule";

export {
  currencyMinorUnitExponent,
  majorMoneyInput,
  parseMajorMoneyInput,
} from "@/features/booking/lib/bookingMoney";

export const BOOKING_WEEKDAYS: readonly Weekday[] = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

export type WorkingPeriodIssue = {
  weekday: Weekday;
  periodIndex: number;
};

export type WorkingHoursOverlap = {
  weekday: Weekday;
  firstIndex: number;
  secondIndex: number;
};

export function cloneWorkingHours(
  hours: WeeklyWorkingHours,
): WeeklyWorkingHours {
  return Object.fromEntries(
    BOOKING_WEEKDAYS.map((weekday) => [
      weekday,
      (hours[weekday] ?? []).map((period) => ({ ...period })),
    ]),
  );
}

export function invalidWorkingPeriods(
  hours: WeeklyWorkingHours,
): WorkingPeriodIssue[] {
  return BOOKING_WEEKDAYS.flatMap((weekday) =>
    (hours[weekday] ?? []).flatMap((period, periodIndex) =>
      period.startTime < period.endTime ? [] : [{ weekday, periodIndex }],
    ),
  );
}

export function findWorkingHoursOverlaps(
  hours: WeeklyWorkingHours,
): WorkingHoursOverlap[] {
  return BOOKING_WEEKDAYS.flatMap((weekday) => {
    const periods = hours[weekday] ?? [];
    const overlaps: WorkingHoursOverlap[] = [];
    for (let firstIndex = 0; firstIndex < periods.length; firstIndex += 1) {
      for (
        let secondIndex = firstIndex + 1;
        secondIndex < periods.length;
        secondIndex += 1
      ) {
        const first = periods[firstIndex];
        const second = periods[secondIndex];
        if (
          first.startTime < second.endTime &&
          second.startTime < first.endTime
        ) {
          overlaps.push({ weekday, firstIndex, secondIndex });
        }
      }
    }
    return overlaps;
  });
}

export function workingHoursCounts(hours: WeeklyWorkingHours): {
  days: number;
  periods: number;
} {
  const counts = BOOKING_WEEKDAYS.map((weekday) => hours[weekday]?.length ?? 0);
  return {
    days: counts.filter((count) => count > 0).length,
    periods: counts.reduce((sum, count) => sum + count, 0),
  };
}

export function branchUsage(
  workspace: BookingWorkspace,
  branchId: string,
): { groups: number; rooms: number; rules: number } {
  const groupById = new Map(workspace.groups.map((group) => [group.id, group]));
  const groupIds = new Set(
    workspace.groups
      .filter((group) => group.branchId === branchId)
      .map((group) => group.id),
  );
  return {
    groups: groupIds.size,
    rooms: workspace.rooms.filter((room) => room.branchId === branchId).length,
    rules: workspace.recurrenceRules.filter((rule) => {
      const group = groupById.get(rule.groupId);
      return (rule.branchIdOverride ?? group?.branchId) === branchId;
    }).length,
  };
}

export function teacherUsage(
  workspace: BookingWorkspace,
  teacherId: string,
): { groups: number; rules: number } {
  const groupById = new Map(workspace.groups.map((group) => [group.id, group]));
  return {
    groups: workspace.groups.filter((group) =>
      group.teacherIds.includes(teacherId),
    ).length,
    rules: workspace.recurrenceRules.filter((rule) => {
      const group = groupById.get(rule.groupId);
      return (rule.teacherIdsOverride ?? group?.teacherIds ?? []).includes(
        teacherId,
      );
    }).length,
  };
}

export type RoomUsage = {
  active: number;
  historical: number;
  groups: number;
  rules: number;
  exceptions: number;
};

export function roomUsage(
  workspace: BookingWorkspace,
  roomId: BookingRoom["id"],
): RoomUsage {
  const groupById = new Map(workspace.groups.map((group) => [group.id, group]));
  const ruleById = new Map(
    workspace.recurrenceRules.map((rule) => [rule.id, rule]),
  );
  const groups = workspace.groups.filter((group) => group.roomId === roomId);
  const rules = workspace.recurrenceRules.filter(
    (rule) => rule.roomIdOverride === roomId,
  );
  const exceptions = workspace.lessonExceptions.filter((exception) => {
    const currentRoomId =
      exception.kind === "override"
        ? exception.override.roomId
        : exception.effective?.roomId;
    return currentRoomId === roomId || exception.original.roomId === roomId;
  });
  const activeGroups = groups.filter(
    (group) => group.status === "active",
  ).length;
  const activeRules = rules.filter((rule) => {
    const group = groupById.get(rule.groupId);
    return rule.status === "active" && group?.status === "active";
  }).length;
  const activeExceptions = exceptions.filter((exception) => {
    if (exception.kind !== "override" || exception.override.roomId !== roomId) {
      return false;
    }
    const rule = ruleById.get(exception.recurrenceRuleId);
    const group = rule ? groupById.get(rule.groupId) : undefined;
    return rule?.status === "active" && group?.status === "active";
  }).length;
  const active = activeGroups + activeRules + activeExceptions;
  return {
    active,
    historical: groups.length + rules.length + exceptions.length - active,
    groups: groups.length,
    rules: rules.length,
    exceptions: exceptions.length,
  };
}

export function groupUsage(
  workspace: BookingWorkspace,
  groupId: string,
): { rules: number; exceptions: number } {
  const ruleIds = new Set(
    workspace.recurrenceRules
      .filter((rule) => rule.groupId === groupId)
      .map((rule) => rule.id),
  );
  return {
    rules: ruleIds.size,
    exceptions: workspace.lessonExceptions.filter((exception) =>
      ruleIds.has(exception.recurrenceRuleId),
    ).length,
  };
}

export function effectiveGroupTrialPolicy(
  workspace: BookingWorkspace,
  group: BookingGroup,
): TrialPolicy {
  return group.trialPolicyOverride ?? workspace.organization.defaultTrialPolicy;
}

export function effectiveGroupAttendanceTracking(
  workspace: BookingWorkspace,
  group: BookingGroup,
): boolean {
  return (
    group.trackAttendanceOverride ??
    workspace.organization.trackAttendanceByDefault
  );
}

export type LessonSeriesValues = {
  recurrenceRuleId: string;
  groupId: string;
  originalDate: string;
  startTime: string;
  endTime: string;
  branchId: string;
  roomId?: string;
  teacherIds: string[];
  capacity?: number;
  trialPolicy: TrialPolicy;
  singleVisitAllowed: boolean;
};

export function getLessonSeriesValues(
  workspace: BookingWorkspace,
  recurrenceRuleId: string,
  originalDate: string,
): LessonSeriesValues | null {
  if (
    !materializeScheduleOccurrence(workspace, recurrenceRuleId, originalDate)
  ) {
    return null;
  }
  const rule = workspace.recurrenceRules.find(
    (candidate) => candidate.id === recurrenceRuleId,
  );
  const group = rule
    ? workspace.groups.find((candidate) => candidate.id === rule.groupId)
    : undefined;
  if (!rule || !group) return null;
  const roomId =
    rule.roomIdOverride !== undefined ? rule.roomIdOverride : group.roomId;
  const capacity =
    rule.capacityOverride !== undefined
      ? (rule.capacityOverride ?? undefined)
      : group.capacity;
  return {
    recurrenceRuleId,
    groupId: group.id,
    originalDate,
    startTime: rule.startTime,
    endTime: rule.endTime,
    branchId: rule.branchIdOverride ?? group.branchId,
    ...(roomId ? { roomId } : {}),
    teacherIds: [...(rule.teacherIdsOverride ?? group.teacherIds)],
    ...(capacity === undefined ? {} : { capacity }),
    trialPolicy:
      rule.trialPolicyOverride ??
      group.trialPolicyOverride ??
      workspace.organization.defaultTrialPolicy,
    singleVisitAllowed:
      group.allowSingleVisitsOverride ??
      workspace.organization.allowSingleVisitsByDefault,
  };
}

export type LessonScheduleCandidate = {
  recurrenceRuleId: string;
  originalDate: string;
  date: string;
  startTime: string;
  endTime: string;
  branchId: string;
  roomId?: string;
  teacherIds: readonly string[];
};

export type LessonScheduleConflict = {
  kind: "outside-working-hours" | "room" | "teacher";
  conflictingGroupId?: string;
  conflictingRuleId?: string;
  conflictingOriginalDate?: string;
  teacherIds?: string[];
};

function weekdayForIsoDate(isoDate: string): Weekday {
  const weekdays: readonly Weekday[] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];
  return weekdays[new Date(`${isoDate}T12:00:00Z`).getUTCDay()];
}

export function findLessonScheduleConflicts(
  workspace: BookingWorkspace,
  candidate: LessonScheduleCandidate,
): LessonScheduleConflict[] {
  const conflicts: LessonScheduleConflict[] = [];
  const branch = workspace.branches.find(
    (item) => item.id === candidate.branchId,
  );
  const weekday = weekdayForIsoDate(candidate.date);
  const withinHours = (branch?.workingHours[weekday] ?? []).some(
    (period) =>
      period.startTime <= candidate.startTime &&
      period.endTime >= candidate.endTime,
  );
  if (!withinHours) conflicts.push({ kind: "outside-working-hours" });

  const candidateId = `${candidate.recurrenceRuleId}:${candidate.originalDate}`;
  const teacherIds = new Set(candidate.teacherIds);
  const otherOccurrences = materializeSchedule(workspace, {
    startsOn: candidate.date,
    endsOn: candidate.date,
  }).filter(
    (occurrence) =>
      occurrence.id !== candidateId && occurrence.status !== "cancelled",
  );
  for (const other of otherOccurrences) {
    if (
      candidate.startTime >= other.endTime ||
      other.startTime >= candidate.endTime
    ) {
      continue;
    }
    if (
      candidate.branchId === other.branchId &&
      candidate.roomId &&
      candidate.roomId === other.roomId
    ) {
      conflicts.push({
        kind: "room",
        conflictingGroupId: other.groupId,
        conflictingRuleId: other.recurrenceRuleId,
        conflictingOriginalDate: other.originalDate,
      });
    }
    const sharedTeachers = other.teacherIds.filter((teacherId) =>
      teacherIds.has(teacherId),
    );
    if (sharedTeachers.length) {
      conflicts.push({
        kind: "teacher",
        conflictingGroupId: other.groupId,
        conflictingRuleId: other.recurrenceRuleId,
        conflictingOriginalDate: other.originalDate,
        teacherIds: sharedTeachers,
      });
    }
  }
  return conflicts;
}

export type GroupScheduleConflict = {
  kind: "outside-working-hours" | "room" | "teacher";
  templateId: string;
  weekday: Weekday;
  conflictingGroupId?: string;
  conflictingRuleId?: string;
  teacherIds?: string[];
};

type EffectiveRule = {
  rule: RecurrenceRule;
  group: BookingGroup;
  branchId: string;
  roomId?: string;
  teacherIds: readonly string[];
};

function effectiveRule(
  group: BookingGroup,
  rule: RecurrenceRule,
): EffectiveRule {
  return {
    rule,
    group,
    branchId: rule.branchIdOverride ?? group.branchId,
    ...(rule.roomIdOverride !== undefined
      ? rule.roomIdOverride
        ? { roomId: rule.roomIdOverride }
        : {}
      : group.roomId
        ? { roomId: group.roomId }
        : {}),
    teacherIds: rule.teacherIdsOverride ?? group.teacherIds,
  };
}

function rangesOverlap(first: RecurrenceRule, second: RecurrenceRule): boolean {
  return first.startsOn <= second.endsOn && second.startsOn <= first.endsOn;
}

function timesOverlap(first: RecurrenceRule, second: RecurrenceRule): boolean {
  return first.startTime < second.endTime && second.startTime < first.endTime;
}

function sharedWeekdays(
  first: RecurrenceRule,
  second: RecurrenceRule,
): Weekday[] {
  const secondDays = new Set(second.weekdays);
  return first.weekdays.filter((weekday) => secondDays.has(weekday));
}

/**
 * Finds advisory conflicts for a group's active weekly templates. The caller
 * may still save after an explicit acknowledgement.
 */
export function findGroupScheduleConflicts(
  workspace: BookingWorkspace,
  group: BookingGroup,
  activeRules: readonly RecurrenceRule[],
): GroupScheduleConflict[] {
  const branchById = new Map(
    workspace.branches.map((branch) => [branch.id, branch]),
  );
  const groupById = new Map(workspace.groups.map((item) => [item.id, item]));
  const candidates = activeRules.map((rule) => effectiveRule(group, rule));
  const existing = workspace.recurrenceRules.flatMap((rule) => {
    if (rule.status !== "active" || rule.groupId === group.id) return [];
    const existingGroup = groupById.get(rule.groupId);
    return existingGroup?.status === "active"
      ? [effectiveRule(existingGroup, rule)]
      : [];
  });
  const conflicts: GroupScheduleConflict[] = [];

  for (const candidate of candidates) {
    const branch = branchById.get(candidate.branchId);
    for (const weekday of candidate.rule.weekdays) {
      const withinHours = (branch?.workingHours[weekday] ?? []).some(
        (period) =>
          period.startTime <= candidate.rule.startTime &&
          period.endTime >= candidate.rule.endTime,
      );
      if (!withinHours) {
        conflicts.push({
          kind: "outside-working-hours",
          templateId: candidate.rule.id,
          weekday,
        });
      }
    }
  }

  const comparisons: Array<[EffectiveRule, EffectiveRule]> = [];
  for (const candidate of candidates) {
    for (const other of existing) comparisons.push([candidate, other]);
  }
  for (let first = 0; first < candidates.length; first += 1) {
    for (let second = first + 1; second < candidates.length; second += 1) {
      comparisons.push([candidates[first], candidates[second]]);
    }
  }

  for (const [candidate, other] of comparisons) {
    if (
      !rangesOverlap(candidate.rule, other.rule) ||
      !timesOverlap(candidate.rule, other.rule)
    ) {
      continue;
    }
    const weekdays = sharedWeekdays(candidate.rule, other.rule);
    if (!weekdays.length) continue;
    const teacherIds = candidate.teacherIds.filter((teacherId) =>
      other.teacherIds.includes(teacherId),
    );
    for (const weekday of weekdays) {
      if (
        candidate.branchId === other.branchId &&
        candidate.roomId &&
        candidate.roomId === other.roomId
      ) {
        conflicts.push({
          kind: "room",
          templateId: candidate.rule.id,
          weekday,
          conflictingGroupId: other.group.id,
          conflictingRuleId: other.rule.id,
        });
      }
      if (teacherIds.length) {
        conflicts.push({
          kind: "teacher",
          templateId: candidate.rule.id,
          weekday,
          conflictingGroupId: other.group.id,
          conflictingRuleId: other.rule.id,
          teacherIds,
        });
      }
    }
  }

  return conflicts;
}

export function updateWorkingPeriod(
  hours: WeeklyWorkingHours,
  weekday: Weekday,
  periodIndex: number,
  update: Partial<WorkingPeriod>,
): WeeklyWorkingHours {
  const periods = [...(hours[weekday] ?? [])];
  periods[periodIndex] = { ...periods[periodIndex], ...update };
  return { ...hours, [weekday]: periods };
}
