import type * as React from "react";
import { Plus, Trash2 } from "lucide-react";

import type { BookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { BOOKING_WEEKDAYS } from "@/features/booking/lib/bookingAdmin";
import type { Weekday } from "@/features/booking/model/bookingCore";
import { AirHopDateInput } from "@/features/booking/ui/AirHopDateInput";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import { Input } from "@/shared/ui/input";

export type GroupScheduleTemplateForm = {
  id: string;
  weekdays: Weekday[];
  startsOn: string;
  endsOn: string;
  startTime: string;
  endTime: string;
};

function Label({ children }: { children: React.ReactNode }) {
  return <span className="text-xs font-medium">{children}</span>;
}

export function GroupScheduleEditor({
  errors,
  locale,
  messages,
  onAdd,
  onChange,
  onRemove,
  value,
}: {
  errors: Readonly<Record<string, string | undefined>>;
  locale: string;
  messages: BookingAdminMessages;
  onAdd: () => void;
  onChange: (id: string, update: Partial<GroupScheduleTemplateForm>) => void;
  onRemove: (id: string) => void;
  value: readonly GroupScheduleTemplateForm[];
}) {
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">{messages.weeklySchedule}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {messages.scheduleHint}
          </p>
        </div>
        <Button onClick={onAdd} size="sm" type="button" variant="outline">
          <Plus />
          {messages.addScheduleTemplate}
        </Button>
      </div>
      <div className="space-y-3">
        {value.map((template, index) => (
          <div
            className="rounded-xl border border-border/70 bg-muted/20 p-4"
            data-testid={`airhop-group-schedule-${index}`}
            key={template.id}
          >
            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_0.8fr_0.8fr_auto] lg:items-end">
              <div className="grid gap-1.5 lg:col-span-5">
                <Label>{messages.scheduleWeekday}</Label>
                <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-input/40 bg-background px-3 py-2">
                  {BOOKING_WEEKDAYS.map((weekday) => (
                    <label
                      className="flex items-center gap-2 text-xs"
                      htmlFor={`${template.id}-${weekday}`}
                      key={weekday}
                    >
                      <Checkbox
                        aria-label={`${messages.weekdayNames[weekday]} ${index + 1}`}
                        checked={template.weekdays.includes(weekday)}
                        id={`${template.id}-${weekday}`}
                        onCheckedChange={(checked) =>
                          onChange(template.id, {
                            weekdays:
                              checked === true
                                ? [...template.weekdays, weekday]
                                : template.weekdays.filter(
                                    (candidate) => candidate !== weekday,
                                  ),
                          })
                        }
                      />
                      {messages.weekdayNames[weekday]}
                    </label>
                  ))}
                </div>
              </div>
              <label
                className="grid gap-1.5"
                htmlFor={`${template.id}-starts-on`}
              >
                <Label>{messages.scheduleStartsOn}</Label>
                <AirHopDateInput
                  aria-label={`${messages.scheduleStartsOn} ${index + 1}`}
                  id={`${template.id}-starts-on`}
                  locale={locale}
                  onChange={(value) =>
                    onChange(template.id, { startsOn: value })
                  }
                  value={template.startsOn}
                />
              </label>
              <label
                className="grid gap-1.5"
                htmlFor={`${template.id}-ends-on`}
              >
                <Label>{messages.scheduleEndsOn}</Label>
                <AirHopDateInput
                  aria-label={`${messages.scheduleEndsOn} ${index + 1}`}
                  id={`${template.id}-ends-on`}
                  locale={locale}
                  onChange={(value) => onChange(template.id, { endsOn: value })}
                  value={template.endsOn}
                />
              </label>
              <label
                className="grid gap-1.5"
                htmlFor={`${template.id}-start-time`}
              >
                <Label>{messages.scheduleStartTime}</Label>
                <Input
                  aria-label={`${messages.scheduleStartTime} ${index + 1}`}
                  id={`${template.id}-start-time`}
                  onChange={(event) =>
                    onChange(template.id, { startTime: event.target.value })
                  }
                  type="time"
                  value={template.startTime}
                />
              </label>
              <label
                className="grid gap-1.5"
                htmlFor={`${template.id}-end-time`}
              >
                <Label>{messages.scheduleEndTime}</Label>
                <Input
                  aria-label={`${messages.scheduleEndTime} ${index + 1}`}
                  id={`${template.id}-end-time`}
                  onChange={(event) =>
                    onChange(template.id, { endTime: event.target.value })
                  }
                  type="time"
                  value={template.endTime}
                />
              </label>
              <Button
                aria-label={messages.removeScheduleTemplate}
                onClick={() => onRemove(template.id)}
                size="icon"
                type="button"
                variant="ghost"
              >
                <Trash2 />
              </Button>
            </div>
            {errors[template.id] ? (
              <p className="mt-2 text-xs text-destructive">
                {errors[template.id]}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
