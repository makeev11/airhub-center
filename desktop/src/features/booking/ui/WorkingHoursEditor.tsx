import { Plus, Trash2 } from "lucide-react";

import {
  BOOKING_WEEKDAYS,
  invalidWorkingPeriods,
  updateWorkingPeriod,
} from "@/features/booking/lib/bookingAdmin";
import type { BookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import type { WeeklyWorkingHours } from "@/features/booking/model/bookingCore";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";

export function WorkingHoursEditor({
  messages,
  onChange,
  value,
}: {
  messages: BookingAdminMessages;
  onChange: (value: WeeklyWorkingHours) => void;
  value: WeeklyWorkingHours;
}) {
  const invalid = invalidWorkingPeriods(value);

  return (
    <fieldset className="space-y-3">
      <legend className="mb-3 text-sm font-medium">
        {messages.workingHours}
      </legend>
      {BOOKING_WEEKDAYS.map((weekday) => {
        const periods = value[weekday] ?? [];
        const enabled = periods.length > 0;
        return (
          <div
            className="grid gap-3 rounded-xl border border-border/70 p-3 md:grid-cols-[10rem_1fr]"
            data-testid={`airhop-hours-${weekday}`}
            key={weekday}
          >
            <div className="flex items-center gap-2 self-start pt-2 text-sm font-medium">
              <Checkbox
                aria-label={`${messages.weekdayNames[weekday]} — ${messages.workingDay}`}
                checked={enabled}
                onCheckedChange={(checked) =>
                  onChange({
                    ...value,
                    [weekday]: checked
                      ? periods.length
                        ? periods
                        : [{ startTime: "09:00", endTime: "18:00" }]
                      : [],
                  })
                }
              />
              <span>{messages.weekdayNames[weekday]}</span>
            </div>
            {enabled ? (
              <div className="space-y-2">
                {periods.map((period, periodIndex) => {
                  const hasError = invalid.some(
                    (issue) =>
                      issue.weekday === weekday &&
                      issue.periodIndex === periodIndex,
                  );
                  return (
                    <div
                      className="space-y-1"
                      // Periods have no domain identity and all inputs are
                      // controlled, so their position is the stable form key.
                      // biome-ignore lint/suspicious/noArrayIndexKey: controlled interval editor
                      key={`${weekday}-${periodIndex}`}
                    >
                      <div className="flex items-center gap-2">
                        <Input
                          aria-label={`${messages.weekdayNames[weekday]} — ${messages.workingPeriodStart}`}
                          className="w-32"
                          onChange={(event) =>
                            onChange(
                              updateWorkingPeriod(value, weekday, periodIndex, {
                                startTime: event.target.value,
                              }),
                            )
                          }
                          type="time"
                          value={period.startTime}
                        />
                        <span className="text-muted-foreground">—</span>
                        <Input
                          aria-label={`${messages.weekdayNames[weekday]} — ${messages.workingPeriodEnd}`}
                          className="w-32"
                          onChange={(event) =>
                            onChange(
                              updateWorkingPeriod(value, weekday, periodIndex, {
                                endTime: event.target.value,
                              }),
                            )
                          }
                          type="time"
                          value={period.endTime}
                        />
                        <Button
                          aria-label={messages.removePeriod}
                          onClick={() =>
                            onChange({
                              ...value,
                              [weekday]: periods.filter(
                                (_, index) => index !== periodIndex,
                              ),
                            })
                          }
                          size="icon"
                          type="button"
                          variant="ghost"
                        >
                          <Trash2 />
                        </Button>
                      </div>
                      {hasError ? (
                        <p className="text-xs text-destructive">
                          {messages.invalidWorkingPeriod}
                        </p>
                      ) : null}
                    </div>
                  );
                })}
                <Button
                  onClick={() =>
                    onChange({
                      ...value,
                      [weekday]: [
                        ...periods,
                        { startTime: "18:00", endTime: "21:00" },
                      ],
                    })
                  }
                  size="sm"
                  type="button"
                  variant="outline"
                >
                  <Plus />
                  {messages.addPeriod}
                </Button>
              </div>
            ) : (
              <p className="self-center text-sm text-muted-foreground">
                {messages.dayOff}
              </p>
            )}
          </div>
        );
      })}
    </fieldset>
  );
}
