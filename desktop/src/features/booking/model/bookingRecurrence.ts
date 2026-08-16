import type {
  RecurrenceRule,
  Weekday,
} from "@/features/booking/model/bookingCore";

const WEEKDAY_BY_UTC_DAY: readonly Weekday[] = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

export function weekdayForIsoDate(value: string): Weekday {
  return WEEKDAY_BY_UTC_DAY[new Date(`${value}T12:00:00Z`).getUTCDay()];
}

export function isRecurrenceRuleOccurrence(
  rule: RecurrenceRule,
  date: string,
): boolean {
  return (
    date >= rule.startsOn &&
    date <= rule.endsOn &&
    rule.weekdays.includes(weekdayForIsoDate(date))
  );
}
