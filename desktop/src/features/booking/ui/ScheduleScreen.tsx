import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  DoorOpen,
  GraduationCap,
  MapPin,
} from "lucide-react";

import { shouldUseAirhopDemo } from "@/features/booking/lib/demoRuntime";
import {
  BOOKING_TIME_ZONE,
  DEMO_BRANCHES,
  getAvailablePlaces,
  getBranch,
  getDemoWeek,
  type BookingBranch,
  type ScheduleLesson,
} from "@/features/booking/model/demoSchedule";
import { Badge, type BadgeProps } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { PageHeader } from "@/shared/ui/PageHeader";

type BranchFilter = "all" | BookingBranch["id"];

const dateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "long",
  timeZone: BOOKING_TIME_ZONE,
});
const dayFormatter = new Intl.DateTimeFormat("ru-RU", {
  weekday: "short",
  timeZone: BOOKING_TIME_ZONE,
});
const shortDateFormatter = new Intl.DateTimeFormat("ru-RU", {
  day: "numeric",
  month: "short",
  timeZone: BOOKING_TIME_ZONE,
});
const moneyFormatter = new Intl.NumberFormat("ru-RU", {
  style: "currency",
  currency: "RUB",
  maximumFractionDigits: 0,
});

function asDate(isoDate: string) {
  return new Date(`${isoDate}T12:00:00Z`);
}

function formatDateRange(startDate: string, endDate: string) {
  return `${dateFormatter.format(asDate(startDate))} — ${dateFormatter.format(
    asDate(endDate),
  )}`;
}

function availability(lesson: ScheduleLesson): {
  label: string;
  variant: BadgeProps["variant"];
} {
  const places = getAvailablePlaces(lesson);
  if (places === null) return { label: "Без ограничений", variant: "outline" };
  if (places === 0) return { label: "Мест нет", variant: "destructive" };
  if (places === 1) return { label: "Осталось 1 место", variant: "warning" };
  return { label: `${places} мест свободно`, variant: "success" };
}

function trialLabel(lesson: ScheduleLesson) {
  return lesson.trial.mode === "free"
    ? "Пробное бесплатно"
    : `Пробное ${moneyFormatter.format(lesson.trial.priceRub)}`;
}

function teacherLabel(lesson: ScheduleLesson) {
  return lesson.teachers?.length
    ? lesson.teachers.join(", ")
    : "Преподаватель не назначен";
}

function LessonCard({
  lesson,
  onOpen,
}: {
  lesson: ScheduleLesson;
  onOpen: (lesson: ScheduleLesson) => void;
}) {
  const branch = getBranch(lesson.branchId);
  const places = availability(lesson);
  const isCancelled = lesson.status === "cancelled";

  return (
    <Card asChild>
      <button
        aria-label={`Открыть занятие ${lesson.groupName}, ${lesson.startTime}`}
        className="w-full space-y-3 p-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid={`airhop-lesson-${lesson.id}`}
        onClick={() => onOpen(lesson)}
        type="button"
      >
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-semibold">
            {lesson.startTime}–{lesson.endTime}
          </span>
          {lesson.status === "moved" ? (
            <Badge variant="warning">Перенесено</Badge>
          ) : null}
          {isCancelled ? <Badge variant="destructive">Отменено</Badge> : null}
        </div>
        <div className={isCancelled ? "opacity-60" : undefined}>
          <p className="text-sm font-semibold leading-snug">
            {lesson.groupName}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {lesson.ageLabel}
          </p>
        </div>
        <div className="space-y-1.5 text-xs text-muted-foreground">
          <p className="flex items-start gap-1.5">
            <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{branch?.name}</span>
          </p>
          <p className="flex items-start gap-1.5">
            <DoorOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{lesson.room ?? branch?.address}</span>
          </p>
          <p className="flex items-start gap-1.5">
            <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{teacherLabel(lesson)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={places.variant}>{places.label}</Badge>
          <Badge variant={lesson.trial.mode === "free" ? "success" : "info"}>
            {trialLabel(lesson)}
          </Badge>
        </div>
      </button>
    </Card>
  );
}

function LessonDetails({
  lesson,
  onOpenChange,
}: {
  lesson: ScheduleLesson | null;
  onOpenChange: (open: boolean) => void;
}) {
  if (!lesson) return null;
  const branch = getBranch(lesson.branchId);
  const places = availability(lesson);

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent data-testid="airhop-lesson-details">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle>{lesson.groupName}</DialogTitle>
            {lesson.status === "moved" ? (
              <Badge variant="warning">Перенесено</Badge>
            ) : null}
            {lesson.status === "cancelled" ? (
              <Badge variant="destructive">Отменено</Badge>
            ) : null}
          </div>
          <DialogDescription>{lesson.ageLabel}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <p className="font-medium">Дата и время</p>
            <p className="text-muted-foreground">
              {dateFormatter.format(asDate(lesson.date))}, {lesson.startTime}–
              {lesson.endTime}
            </p>
            {lesson.movedFrom ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                Перенесено с {lesson.movedFrom}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <p className="font-medium">Филиал</p>
            <p className="text-muted-foreground">
              {branch?.name}, {branch?.address}
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">Кабинет</p>
            <p className="text-muted-foreground">
              {lesson.room ?? "Не указан — показываем адрес филиала"}
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">Преподаватели</p>
            <p className="text-muted-foreground">{teacherLabel(lesson)}</p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">Места</p>
            <p className="text-muted-foreground">
              {lesson.capacity === undefined
                ? "Без ограничения"
                : `${lesson.booked} из ${lesson.capacity} занято`}
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">Пробное занятие</p>
            <p className="text-muted-foreground">{trialLabel(lesson)}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
          <Badge variant={places.variant}>{places.label}</Badge>
          <Badge variant="outline">{BOOKING_TIME_ZONE}</Badge>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DemoUnavailable() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <Card className="max-w-lg space-y-3 p-6 text-center">
        <CalendarDays className="mx-auto h-8 w-8 text-muted-foreground" />
        <h2 className="text-lg font-semibold">Расписание ещё не подключено</h2>
        <p className="text-sm text-muted-foreground">
          Подключите Booking API организации, чтобы здесь появились реальные
          филиалы, группы и занятия.
        </p>
      </Card>
    </div>
  );
}

export function ScheduleScreen({ requestedDemo }: { requestedDemo?: string }) {
  const [weekOffset, setWeekOffset] = React.useState(0);
  const [branchFilter, setBranchFilter] = React.useState<BranchFilter>("all");
  const [selectedLesson, setSelectedLesson] =
    React.useState<ScheduleLesson | null>(null);
  const demoEnabled = shouldUseAirhopDemo(requestedDemo);
  const week = React.useMemo(() => getDemoWeek(weekOffset), [weekOffset]);
  const visibleLessons = React.useMemo(
    () =>
      branchFilter === "all"
        ? week.lessons
        : week.lessons.filter((lesson) => lesson.branchId === branchFilter),
    [branchFilter, week.lessons],
  );

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-6 py-5">
        <PageHeader
          action={demoEnabled ? <Badge variant="info">Демоцентр</Badge> : null}
          description={`Buzz AirHop · ${BOOKING_TIME_ZONE}`}
          title="Расписание"
        />
      </header>

      {!demoEnabled ? (
        <DemoUnavailable />
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/70 px-6 py-3">
            <div className="flex items-center gap-2">
              <Button
                aria-label="Предыдущая неделя"
                onClick={() => setWeekOffset((value) => value - 1)}
                size="icon"
                variant="outline"
              >
                <ArrowLeft />
              </Button>
              <Button onClick={() => setWeekOffset(0)} variant="outline">
                Сегодня
              </Button>
              <Button
                aria-label="Следующая неделя"
                onClick={() => setWeekOffset((value) => value + 1)}
                size="icon"
                variant="outline"
              >
                <ArrowRight />
              </Button>
              <p
                className="ml-2 text-sm font-semibold"
                data-testid="airhop-week-range"
              >
                {formatDateRange(week.startDate, week.endDate)}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Филиал</span>
              <select
                className="h-9 appearance-none rounded-lg border border-input/40 bg-background px-3 text-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="airhop-branch-filter"
                onChange={(event) =>
                  setBranchFilter(event.target.value as BranchFilter)
                }
                value={branchFilter}
              >
                <option value="all">Все филиалы</option>
                {DEMO_BRANCHES.map((branch) => (
                  <option key={branch.id} value={branch.id}>
                    {branch.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div
            className="min-h-0 flex-1 overflow-auto p-6"
            data-testid="airhop-schedule-grid-scroll"
          >
            <div
              className="grid min-w-[72rem] grid-cols-7 gap-px overflow-hidden rounded-xl border border-border/70 bg-border/70"
              data-testid="airhop-schedule-grid"
            >
              {week.dates.map((date, dayIndex) => {
                const lessons = visibleLessons.filter(
                  (lesson) => lesson.dayIndex === dayIndex,
                );
                return (
                  <section className="min-w-0 bg-background" key={date}>
                    <div className="sticky top-0 z-10 border-b border-border/70 bg-background/95 px-3 py-3 backdrop-blur">
                      <p className="text-xs font-semibold uppercase text-muted-foreground">
                        {dayFormatter.format(asDate(date))}
                      </p>
                      <p className="mt-0.5 text-sm font-semibold">
                        {shortDateFormatter.format(asDate(date))}
                      </p>
                    </div>
                    <div className="space-y-2 p-2">
                      {lessons.length ? (
                        lessons.map((lesson) => (
                          <LessonCard
                            key={lesson.id}
                            lesson={lesson}
                            onOpen={setSelectedLesson}
                          />
                        ))
                      ) : (
                        <p className="rounded-lg border border-dashed border-border/70 px-2 py-5 text-center text-xs text-muted-foreground">
                          Нет занятий
                        </p>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>
          </div>
        </>
      )}

      <LessonDetails
        lesson={selectedLesson}
        onOpenChange={(open) => {
          if (!open) setSelectedLesson(null);
        }}
      />
    </div>
  );
}
