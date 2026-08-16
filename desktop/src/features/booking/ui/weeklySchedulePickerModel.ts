import { BOOKING_WEEKDAYS } from "@/features/booking/lib/bookingAdmin";
import type {
  BookingWorkspace,
  Weekday,
  WeeklyScheduleSelection,
} from "@/features/booking/model/bookingCore";

export type WeeklySlotOption = WeeklyScheduleSelection & {
  startTime: string;
  endTime: string;
  startsOn: string;
  endsOn: string;
};

const weekdayIndex = new Map<Weekday, number>(
  BOOKING_WEEKDAYS.map((weekday, index) => [weekday, index]),
);

export function deriveWeeklySlotOptions(
  workspace: BookingWorkspace,
  groupId: string,
): WeeklySlotOption[] {
  return workspace.recurrenceRules
    .filter((rule) => rule.groupId === groupId && rule.status === "active")
    .flatMap((rule) =>
      rule.weekdays.map((weekday) => ({
        recurrenceRuleId: rule.id,
        weekday,
        startTime: rule.startTime,
        endTime: rule.endTime,
        startsOn: rule.startsOn,
        endsOn: rule.endsOn,
      })),
    )
    .sort(
      (first, second) =>
        (weekdayIndex.get(first.weekday) ?? 0) -
          (weekdayIndex.get(second.weekday) ?? 0) ||
        first.startTime.localeCompare(second.startTime) ||
        first.endTime.localeCompare(second.endTime) ||
        first.recurrenceRuleId.localeCompare(second.recurrenceRuleId),
    );
}

function sameSelection(
  first: WeeklyScheduleSelection,
  second: WeeklyScheduleSelection,
): boolean {
  return (
    first.recurrenceRuleId === second.recurrenceRuleId &&
    first.weekday === second.weekday
  );
}

export function isWeeklySlotSelectionDisabled(
  option: WeeklyScheduleSelection,
  selected: readonly WeeklyScheduleSelection[],
  maxSelections: number,
): boolean {
  if (selected.some((candidate) => sameSelection(candidate, option))) {
    return false;
  }
  return selected.length >= maxSelections;
}

export function toggleWeeklySlotSelection(
  option: WeeklyScheduleSelection,
  selected: readonly WeeklyScheduleSelection[],
  maxSelections: number,
): WeeklyScheduleSelection[] {
  const existingIndex = selected.findIndex((candidate) =>
    sameSelection(candidate, option),
  );
  if (existingIndex >= 0) {
    return selected.filter((_, index) => index !== existingIndex);
  }
  if (selected.length >= maxSelections) return [...selected];
  return [...selected, option];
}
