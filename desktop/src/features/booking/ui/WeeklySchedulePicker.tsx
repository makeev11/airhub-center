import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import type { WeeklyScheduleSelection } from "@/features/booking/model/bookingCore";
import {
  isWeeklySlotSelectionDisabled,
  toggleWeeklySlotSelection,
  type WeeklySlotOption,
} from "@/features/booking/ui/weeklySchedulePickerModel";
import { Checkbox } from "@/shared/ui/checkbox";
import { cn } from "@/shared/lib/cn";

function sameSelection(
  first: WeeklyScheduleSelection,
  second: WeeklyScheduleSelection,
): boolean {
  return (
    first.recurrenceRuleId === second.recurrenceRuleId &&
    first.weekday === second.weekday
  );
}

export function WeeklySchedulePicker({
  locale,
  maxSelections,
  onChange,
  options,
  value,
}: {
  locale: string;
  maxSelections: number;
  onChange: (value: WeeklyScheduleSelection[]) => void;
  options: readonly WeeklySlotOption[];
  value: readonly WeeklyScheduleSelection[];
}) {
  const messages = getBookingAdminMessages(locale);
  const formatters = createBookingFormatters(locale);
  const limitReached = value.length >= maxSelections;

  if (!options.length) {
    return (
      <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-muted-foreground">
        {messages.enrollmentNoWeeklySlots}
      </p>
    );
  }

  return (
    <div className="space-y-3" data-testid="airhop-weekly-schedule-picker">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="font-medium text-foreground">
          {messages.enrollmentSelectedSlots(value.length, maxSelections)}
        </span>
        {limitReached ? (
          <span className="text-muted-foreground">
            {messages.enrollmentSlotLimitReached(maxSelections)}
          </span>
        ) : null}
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const checked = value.some((selection) =>
            sameSelection(selection, option),
          );
          const disabled = isWeeklySlotSelectionDisabled(
            option,
            value,
            maxSelections,
          );
          const key = `${option.recurrenceRuleId}:${option.weekday}`;
          return (
            <label
              className={cn(
                "flex min-w-0 items-center gap-3 rounded-xl border border-border/70 px-3 py-3 transition-colors",
                checked && "border-primary bg-primary/10",
                disabled && "cursor-not-allowed opacity-55",
                !disabled && "cursor-pointer hover:bg-muted/50",
              )}
              data-testid={`airhop-weekly-slot-${key}`}
              htmlFor={`airhop-weekly-slot-input-${key}`}
              key={key}
            >
              <Checkbox
                aria-label={`${formatters.weekdayName(option.weekday)}, ${option.startTime}–${option.endTime}`}
                checked={checked}
                disabled={disabled}
                id={`airhop-weekly-slot-input-${key}`}
                onCheckedChange={() =>
                  onChange(
                    toggleWeeklySlotSelection(option, value, maxSelections),
                  )
                }
              />
              <span className="min-w-0">
                <span className="block font-medium">
                  {formatters.weekdayName(option.weekday)}
                </span>
                <span className="block text-xs tabular-nums text-muted-foreground">
                  {option.startTime}–{option.endTime}
                </span>
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}
