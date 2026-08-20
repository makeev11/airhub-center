import * as React from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";

import {
  airHopDateToIso,
  formatAirHopDateInput,
  isAirHopDateInRange,
  maskAirHopDateInput,
  parseAirHopDateInput,
  parseAirHopIsoDate,
} from "@/features/booking/lib/airHopDateInput";
import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { BookingSelect } from "@/features/booking/ui/BookingSelect";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";

type AirHopDateInputProps = Omit<
  React.ComponentProps<typeof Input>,
  "max" | "min" | "onChange" | "type" | "value"
> & {
  locale?: string;
  max?: string;
  min?: string;
  onChange: (value: string) => void;
  value: string;
};

function localToday() {
  const now = new Date();
  return {
    day: now.getDate(),
    month: now.getMonth() + 1,
    year: now.getFullYear(),
  };
}

export function AirHopDateInput({
  className,
  disabled,
  locale,
  max,
  min,
  onBlur,
  onChange,
  onFocus,
  value,
  ...inputProps
}: AirHopDateInputProps) {
  const interfaceLocale = useAirHopLocale();
  const calendarLocale = locale ?? interfaceLocale;
  const isRussian = calendarLocale.startsWith("ru");
  const [open, setOpen] = React.useState(false);
  const [editing, setEditing] = React.useState(false);
  const [draft, setDraft] = React.useState(() => formatAirHopDateInput(value));
  const initialDate = parseAirHopIsoDate(value) ?? localToday();
  const [visibleMonth, setVisibleMonth] = React.useState(initialDate.month);
  const [visibleYear, setVisibleYear] = React.useState(initialDate.year);

  React.useEffect(() => {
    if (!editing) setDraft(formatAirHopDateInput(value));
  }, [editing, value]);

  const selected = parseAirHopIsoDate(value);
  const minDate = min ? parseAirHopIsoDate(min) : null;
  const maxDate = max ? parseAirHopIsoDate(max) : null;
  const today = localToday();
  const minYear = minDate?.year ?? today.year - 120;
  const maxYear = maxDate?.year ?? today.year + 50;
  const yearOptions = React.useMemo(
    () =>
      Array.from(
        { length: Math.max(1, maxYear - minYear + 1) },
        (_, index) => minYear + index,
      ),
    [maxYear, minYear],
  );
  const monthNames = React.useMemo(
    () =>
      Array.from({ length: 12 }, (_, month) =>
        new Intl.DateTimeFormat(calendarLocale, { month: "long" }).format(
          new Date(2024, month, 1),
        ),
      ),
    [calendarLocale],
  );
  const weekdayNames = React.useMemo(
    () =>
      Array.from({ length: 7 }, (_, offset) =>
        new Intl.DateTimeFormat(calendarLocale, { weekday: "short" })
          .format(new Date(2024, 0, 1 + offset))
          .replace(".", ""),
      ),
    [calendarLocale],
  );

  const firstWeekday =
    (new Date(visibleYear, visibleMonth - 1, 1).getDay() + 6) % 7;
  const dayCount = new Date(visibleYear, visibleMonth, 0).getDate();
  const cells = Array.from({ length: 42 }, (_, index) => {
    const day = index - firstWeekday + 1;
    return {
      day: day > 0 && day <= dayCount ? day : null,
      key: `${visibleYear}-${visibleMonth}-${index}`,
    };
  });

  const changeVisibleMonth = (delta: number) => {
    const next = new Date(visibleYear, visibleMonth - 1 + delta, 1);
    const nextYear = next.getFullYear();
    if (nextYear < minYear || nextYear > maxYear) return;
    setVisibleYear(nextYear);
    setVisibleMonth(next.getMonth() + 1);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) return;
    const nextDate =
      parseAirHopIsoDate(value) ??
      parseAirHopIsoDate(parseAirHopDateInput(draft) ?? "") ??
      localToday();
    setVisibleMonth(nextDate.month);
    setVisibleYear(nextDate.year);
  };

  return (
    <Popover onOpenChange={handleOpenChange} open={open}>
      <div className="relative">
        <Input
          {...inputProps}
          className={cn("pr-10 tabular-nums", className)}
          disabled={disabled}
          inputMode="numeric"
          onBlur={(event) => {
            setEditing(false);
            if (!parseAirHopDateInput(draft)) {
              setDraft(formatAirHopDateInput(value));
            }
            onBlur?.(event);
          }}
          onChange={(event) => {
            const nextDraft = maskAirHopDateInput(event.target.value);
            setDraft(nextDraft);
            const parsed = parseAirHopDateInput(nextDraft);
            onChange(
              parsed && isAirHopDateInRange(parsed, min, max) ? parsed : "",
            );
          }}
          onFocus={(event) => {
            setEditing(true);
            onFocus?.(event);
          }}
          placeholder={isRussian ? "ДД.ММ.ГГГГ" : "DD.MM.YYYY"}
          type="text"
          value={draft}
        />
        <PopoverTrigger asChild>
          <Button
            aria-label={`${inputProps["aria-label"] ?? (isRussian ? "Дата" : "Date")}: ${isRussian ? "открыть календарь" : "open calendar"}`}
            className="absolute right-1 top-1/2 size-7 -translate-y-1/2"
            disabled={disabled}
            size="icon"
            type="button"
            variant="ghost"
          >
            <CalendarDays className="size-4" />
          </Button>
        </PopoverTrigger>
      </div>
      <PopoverContent align="start" className="w-[19rem] p-3">
        <div className="flex items-center gap-1">
          <Button
            aria-label={isRussian ? "Предыдущий месяц" : "Previous month"}
            onClick={() => changeVisibleMonth(-1)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronLeft />
          </Button>
          <BookingSelect
            aria-label={isRussian ? "Месяц" : "Month"}
            className="h-8 rounded-md border-input/60 pr-8 pl-2 font-medium capitalize"
            onChange={(event) => setVisibleMonth(Number(event.target.value))}
            value={visibleMonth}
            wrapperClassName="flex-1"
          >
            {monthNames.map((name, index) => (
              <option key={name} value={index + 1}>
                {name}
              </option>
            ))}
          </BookingSelect>
          <BookingSelect
            aria-label={isRussian ? "Год" : "Year"}
            className="h-8 rounded-md border-input/60 pr-7 pl-2 font-medium"
            onChange={(event) => setVisibleYear(Number(event.target.value))}
            value={visibleYear}
            wrapperClassName="w-24"
          >
            {yearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </BookingSelect>
          <Button
            aria-label={isRussian ? "Следующий месяц" : "Next month"}
            onClick={() => changeVisibleMonth(1)}
            size="icon"
            type="button"
            variant="ghost"
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="mt-3 grid grid-cols-7 gap-1">
          {weekdayNames.map((weekday) => (
            <span
              className="flex h-7 items-center justify-center text-xs font-medium text-muted-foreground"
              key={weekday}
            >
              {weekday}
            </span>
          ))}
          {cells.map(({ day, key }) => {
            if (!day) {
              return <span aria-hidden="true" key={key} />;
            }
            const iso = airHopDateToIso({
              day,
              month: visibleMonth,
              year: visibleYear,
            });
            const selectable = Boolean(
              iso && isAirHopDateInRange(iso, min, max),
            );
            const isSelected = Boolean(
              selected &&
                selected.day === day &&
                selected.month === visibleMonth &&
                selected.year === visibleYear,
            );
            const isToday =
              today.day === day &&
              today.month === visibleMonth &&
              today.year === visibleYear;
            return (
              <button
                aria-label={`${String(day).padStart(2, "0")}.${String(visibleMonth).padStart(2, "0")}.${visibleYear}`}
                aria-pressed={isSelected}
                className={cn(
                  "flex size-8 items-center justify-center rounded-md text-sm tabular-nums transition-colors hover:bg-accent focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-30",
                  isSelected &&
                    "bg-primary text-primary-foreground hover:bg-primary/90",
                  isToday && !isSelected && "ring-1 ring-primary/50",
                )}
                disabled={!selectable}
                key={key}
                onClick={() => {
                  if (!iso) return;
                  onChange(iso);
                  setDraft(formatAirHopDateInput(iso));
                  setOpen(false);
                }}
                type="button"
              >
                {day}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
