import * as React from "react";
import {
  ArrowLeft,
  ArrowRight,
  DoorOpen,
  GraduationCap,
  MapPin,
} from "lucide-react";

import { createStaffActionContext } from "@/features/booking/actions/airhopActionContext";
import { executeAirhopAction } from "@/features/booking/actions/airhopActionService";

import {
  createBookingFormatters,
  getBookingMessages,
  type BookingFormatters,
  type BookingMessages,
} from "@/features/booking/lib/bookingLocale";
import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  getBookingBranches,
  getAvailablePlaces,
  getIsoDateInTimeZone,
  getWorkspaceWeek,
  type BookingBranch,
  type ScheduleLesson,
} from "@/features/booking/model/demoSchedule";
import type {
  BookingAttendanceRecord,
  BookingWorkspace,
} from "@/features/booking/model/bookingCore";
import {
  restoreBookingLessonToSeries,
  upsertBookingLessonException,
} from "@/features/booking/model/bookingMutations";
import {
  BookingFeedbackBanners,
  BookingWorkspaceGate,
} from "@/features/booking/ui/BookingWorkspaceState";
import { BookingSelect } from "@/features/booking/ui/BookingSelect";
import { LessonEditDialog } from "@/features/booking/ui/LessonEditDialog";
import { LessonParticipantDialog } from "@/features/booking/ui/LessonParticipantDialog";
import { LessonRoster } from "@/features/booking/ui/LessonRoster";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/shared/ui/alert-dialog";
import { Alert, AlertDescription } from "@/shared/ui/alert";
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

function formatDateRange(
  startDate: string,
  endDate: string,
  formatters: BookingFormatters,
) {
  return `${formatters.date(startDate)} — ${formatters.date(endDate)}`;
}

function availability(
  lesson: ScheduleLesson,
  messages: BookingMessages,
): {
  label: string;
  variant: BadgeProps["variant"];
} {
  const places = getAvailablePlaces(lesson);
  if (places === null) return { label: messages.unlimited, variant: "outline" };
  if (places === 0) return { label: messages.noPlaces, variant: "destructive" };
  if (places === 1) return { label: messages.onePlaceLeft, variant: "warning" };
  return { label: messages.placesFree(places), variant: "success" };
}

function trialLabel(
  lesson: ScheduleLesson,
  messages: BookingMessages,
  formatters: BookingFormatters,
) {
  if (lesson.trial.mode === "disabled") return messages.trialUnavailable;
  return lesson.trial.mode === "free"
    ? messages.trialFree
    : messages.trialPaid(
        formatters.money(lesson.trial.amountMinor, lesson.trial.currency),
      );
}

function teacherLabel(lesson: ScheduleLesson, messages: BookingMessages) {
  return lesson.teachers?.length
    ? lesson.teachers.join(", ")
    : messages.teacherUnassigned;
}

function LessonCard({
  lesson,
  messages,
  onOpen,
}: {
  lesson: ScheduleLesson;
  messages: BookingMessages;
  onOpen: (lesson: ScheduleLesson) => void;
}) {
  const places = availability(lesson, messages);
  const isCancelled = lesson.status === "cancelled";

  return (
    <Card asChild>
      <button
        aria-label={messages.openLesson(lesson.groupName, lesson.startTime)}
        className="w-full space-y-3 p-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
        data-testid={`airhop-lesson-${lesson.id}`}
        onClick={() => onOpen(lesson)}
        type="button"
      >
        <div className="space-y-1.5">
          <span className="block text-sm font-semibold">
            {lesson.startTime}–{lesson.endTime}
          </span>
          {lesson.status === "moved" ? (
            <Badge className="max-w-full" variant="warning">
              {messages.moved}
            </Badge>
          ) : null}
          {lesson.status === "modified" ? (
            <Badge className="max-w-full" variant="outline">
              {messages.modified}
            </Badge>
          ) : null}
          {isCancelled ? (
            <Badge className="max-w-full" variant="destructive">
              {messages.cancelled}
            </Badge>
          ) : null}
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
            <span>{lesson.branchName}</span>
          </p>
          {lesson.branchStatus === "archived" ? (
            <Badge variant="secondary">{messages.archivedBranch}</Badge>
          ) : null}
          <p className="flex items-start gap-1.5">
            <DoorOpen className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{lesson.room ?? lesson.branchAddress}</span>
          </p>
          <p className="flex items-start gap-1.5">
            <GraduationCap className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{teacherLabel(lesson, messages)}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant={places.variant}>{places.label}</Badge>
        </div>
      </button>
    </Card>
  );
}

function LessonDetails({
  formatters,
  lesson,
  messages,
  onCancel,
  onEdit,
  onAddParticipant,
  onOpenChange,
  onRestore,
  onSetAttendance,
  isSaving,
  timeZone,
  workspace,
}: {
  formatters: BookingFormatters;
  lesson: ScheduleLesson | null;
  messages: BookingMessages;
  onCancel: (lesson: ScheduleLesson) => void;
  onEdit: (lesson: ScheduleLesson) => void;
  onAddParticipant: (lesson: ScheduleLesson) => void;
  onOpenChange: (open: boolean) => void;
  onRestore: (lesson: ScheduleLesson) => void;
  onSetAttendance: (
    childId: string,
    status: BookingAttendanceRecord["status"] | null,
  ) => void;
  isSaving: boolean;
  timeZone: string;
  workspace: BookingWorkspace;
}) {
  if (!lesson) return null;
  const places = availability(lesson, messages);

  return (
    <Dialog onOpenChange={onOpenChange} open>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto"
        data-testid="airhop-lesson-details"
      >
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle>{lesson.groupName}</DialogTitle>
            {lesson.status === "moved" ? (
              <Badge variant="warning">{messages.moved}</Badge>
            ) : null}
            {lesson.status === "cancelled" ? (
              <Badge variant="destructive">{messages.cancelled}</Badge>
            ) : null}
            {lesson.status === "modified" ? (
              <Badge variant="outline">{messages.modified}</Badge>
            ) : null}
          </div>
          <DialogDescription>{lesson.ageLabel}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 text-sm sm:grid-cols-2">
          <div className="space-y-1">
            <p className="font-medium">{messages.dateAndTime}</p>
            <p className="text-muted-foreground">
              {formatters.date(lesson.date)}, {lesson.startTime}–
              {lesson.endTime}
            </p>
            {lesson.movedFrom ? (
              <p className="text-xs text-amber-600 dark:text-amber-400">
                {messages.movedFrom(
                  formatters.date(lesson.movedFrom.date),
                  lesson.movedFrom.startTime,
                  lesson.movedFrom.endTime,
                )}
              </p>
            ) : null}
          </div>
          <div className="space-y-1">
            <p className="font-medium">{messages.branch}</p>
            <p className="text-muted-foreground">
              {lesson.branchName}, {lesson.branchAddress}
            </p>
            {lesson.branchStatus === "archived" ? (
              <Badge variant="secondary">{messages.archivedBranch}</Badge>
            ) : null}
          </div>
          <div className="space-y-1">
            <p className="font-medium">{messages.room}</p>
            <p className="text-muted-foreground">
              {lesson.room ?? messages.roomFallback}
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">{messages.teachers}</p>
            <p className="text-muted-foreground">
              {teacherLabel(lesson, messages)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">{messages.places}</p>
            <p className="text-muted-foreground">
              {lesson.capacity === undefined
                ? messages.unlimitedCapacity
                : messages.occupiedPlaces(lesson.booked, lesson.capacity)}
            </p>
          </div>
          <div className="space-y-1">
            <p className="font-medium">{messages.trialLesson}</p>
            <p className="text-muted-foreground">
              {trialLabel(lesson, messages, formatters)}
            </p>
          </div>
        </div>
        <LessonRoster
          isSaving={isSaving}
          lessonRef={{
            recurrenceRuleId: lesson.recurrenceRuleId,
            originalDate: lesson.originalDate,
          }}
          onSetAttendance={onSetAttendance}
          trackAttendance={lesson.trackAttendance}
          workspace={workspace}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border/70 pt-4">
          <div className="flex flex-wrap gap-2">
            <Badge variant={places.variant}>{places.label}</Badge>
            <Badge variant="outline">{timeZone}</Badge>
          </div>
          <div className="flex flex-wrap gap-2">
            {lesson.status !== "cancelled" ? (
              <Button
                data-testid="airhop-add-participant"
                onClick={() => onAddParticipant(lesson)}
                size="sm"
                variant="outline"
              >
                {
                  getBookingAdminMessages(workspace.organization.locale)
                    .lessonAddParticipant
                }
              </Button>
            ) : null}
            {lesson.exceptionId ? (
              <Button
                data-testid="airhop-restore-lesson"
                onClick={() => onRestore(lesson)}
                size="sm"
                variant="ghost"
              >
                {messages.restoreLesson}
              </Button>
            ) : null}
            {lesson.status !== "cancelled" ? (
              <Button
                data-testid="airhop-cancel-lesson"
                onClick={() => onCancel(lesson)}
                size="sm"
                variant="outline"
              >
                {messages.cancelLesson}
              </Button>
            ) : null}
            <Button
              data-testid="airhop-edit-lesson"
              onClick={() => onEdit(lesson)}
              size="sm"
            >
              {messages.editLesson}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleWorkspaceScreen({
  workspace,
}: {
  workspace: BookingWorkspace;
}) {
  const booking = useBookingWorkspace();
  const [weekOffset, setWeekOffset] = React.useState(0);
  const [branchFilter, setBranchFilter] = React.useState<BranchFilter>("all");
  const [selectedLesson, setSelectedLesson] =
    React.useState<ScheduleLesson | null>(null);
  const [editLesson, setEditLesson] = React.useState<ScheduleLesson | null>(
    null,
  );
  const [participantLesson, setParticipantLesson] =
    React.useState<ScheduleLesson | null>(null);
  const [cancelTarget, setCancelTarget] = React.useState<ScheduleLesson | null>(
    null,
  );
  const [restoreTarget, setRestoreTarget] =
    React.useState<ScheduleLesson | null>(null);
  const [successMessage, setSuccessMessage] = React.useState<string | null>(
    null,
  );
  const [referenceDate, setReferenceDate] = React.useState(() =>
    getIsoDateInTimeZone(workspace.organization.timeZone),
  );
  React.useEffect(() => {
    setReferenceDate(getIsoDateInTimeZone(workspace.organization.timeZone));
    setWeekOffset(0);
  }, [workspace.organization.timeZone]);
  const messages = React.useMemo(
    () => getBookingMessages(workspace.organization.locale),
    [workspace.organization.locale],
  );
  const formatters = React.useMemo(
    () => createBookingFormatters(workspace.organization.locale),
    [workspace.organization.locale],
  );
  const adminMessages = React.useMemo(
    () => getBookingAdminMessages(workspace.organization.locale),
    [workspace.organization.locale],
  );
  const week = React.useMemo(
    () => getWorkspaceWeek(workspace, weekOffset, referenceDate),
    [referenceDate, weekOffset, workspace],
  );
  const branches = React.useMemo(
    () => getBookingBranches(workspace),
    [workspace],
  );
  React.useEffect(() => {
    if (
      branchFilter !== "all" &&
      !branches.some((branch) => branch.id === branchFilter)
    ) {
      setBranchFilter("all");
    }
  }, [branchFilter, branches]);
  const visibleLessons = React.useMemo(
    () =>
      branchFilter === "all"
        ? week.lessons
        : week.lessons.filter((lesson) => lesson.branchId === branchFilter),
    [branchFilter, week.lessons],
  );
  const currentLesson = React.useCallback(
    (lesson: ScheduleLesson | null) =>
      lesson
        ? (week.lessons.find(
            (candidate) =>
              candidate.recurrenceRuleId === lesson.recurrenceRuleId &&
              candidate.originalDate === lesson.originalDate,
          ) ?? lesson)
        : null,
    [week.lessons],
  );
  const resolvedSelectedLesson = currentLesson(selectedLesson);
  const resolvedParticipantLesson = currentLesson(participantLesson);

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-6 py-5">
        <PageHeader
          description={`${workspace.organization.name} · ${workspace.organization.timeZone}`}
          title={messages.scheduleTitle}
        />
      </header>

      <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-b border-border/70 px-6 py-3">
        <div className="flex items-center gap-2">
          <Button
            aria-label={messages.previousWeek}
            onClick={() => setWeekOffset((value) => value - 1)}
            size="icon"
            variant="outline"
          >
            <ArrowLeft />
          </Button>
          <Button
            onClick={() => {
              setReferenceDate(
                getIsoDateInTimeZone(workspace.organization.timeZone),
              );
              setWeekOffset(0);
            }}
            variant="outline"
          >
            {messages.today}
          </Button>
          <Button
            aria-label={messages.nextWeek}
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
            {formatDateRange(week.startDate, week.endDate, formatters)}
          </p>
        </div>
        <label
          className="flex items-center gap-2 text-sm"
          htmlFor="airhop-branch-filter"
        >
          <span className="text-muted-foreground">{messages.branch}</span>
          <BookingSelect
            data-testid="airhop-branch-filter"
            id="airhop-branch-filter"
            onChange={(event) =>
              setBranchFilter(event.target.value as BranchFilter)
            }
            value={branchFilter}
          >
            <option value="all">{messages.allBranches}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.name}
              </option>
            ))}
          </BookingSelect>
        </label>
      </div>

      {booking.conflict || booking.error || booking.notice || successMessage ? (
        <div className="shrink-0 space-y-3 border-b border-border/70 px-6 py-3">
          <BookingFeedbackBanners />
          {successMessage ? (
            <Alert data-testid="airhop-lesson-success">
              <AlertDescription>{successMessage}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

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
                    {formatters.weekday(date)}
                  </p>
                  <p className="mt-0.5 text-sm font-semibold">
                    {formatters.shortDate(date)}
                  </p>
                </div>
                <div className="space-y-2 p-2">
                  {lessons.length ? (
                    lessons.map((lesson) => (
                      <LessonCard
                        key={lesson.id}
                        lesson={lesson}
                        messages={messages}
                        onOpen={setSelectedLesson}
                      />
                    ))
                  ) : (
                    <p className="rounded-lg border border-dashed border-border/70 px-2 py-5 text-center text-xs text-muted-foreground">
                      {messages.noLessons}
                    </p>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>

      <LessonDetails
        formatters={formatters}
        isSaving={booking.isSaving}
        lesson={resolvedSelectedLesson}
        messages={messages}
        onAddParticipant={setParticipantLesson}
        onCancel={(lesson) => {
          setSelectedLesson(null);
          setCancelTarget(lesson);
        }}
        onEdit={(lesson) => {
          setSelectedLesson(null);
          setEditLesson(lesson);
        }}
        onOpenChange={(open) => {
          if (!open) setSelectedLesson(null);
        }}
        onRestore={(lesson) => {
          setSelectedLesson(null);
          setRestoreTarget(lesson);
        }}
        onSetAttendance={(childId, status) => {
          if (!resolvedSelectedLesson) return;
          const lessonRef = {
            recurrenceRuleId: resolvedSelectedLesson.recurrenceRuleId,
            originalDate: resolvedSelectedLesson.originalDate,
          };
          void booking.save(
            (current) =>
              executeAirhopAction(
                current,
                { type: "MarkAttendance", childId, lessonRef, status },
                { userId: "buzz-staff", surface: "staff_ui" },
                createStaffActionContext(new Date().toISOString(), () =>
                  crypto.randomUUID(),
                ),
              ).draft,
          );
        }}
        timeZone={workspace.organization.timeZone}
        workspace={workspace}
      />

      <LessonParticipantDialog
        lesson={resolvedParticipantLesson}
        onOpenChange={(open) => {
          if (!open) setParticipantLesson(null);
        }}
        onSaved={() => {
          setSuccessMessage(adminMessages.participantAdded);
        }}
        open={participantLesson !== null}
      />

      <LessonEditDialog
        lesson={editLesson}
        onOpenChange={(open) => {
          if (!open) setEditLesson(null);
        }}
        onSaved={() => {
          setSuccessMessage(messages.lessonUpdated);
          setEditLesson(null);
        }}
        open={editLesson !== null}
      />

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        open={cancelTarget !== null}
      >
        <AlertDialogContent data-testid="airhop-cancel-lesson-dialog">
          <BookingFeedbackBanners />
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.cancelLessonTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {cancelTarget
                ? messages.cancelLessonDescription(
                    formatters.date(cancelTarget.date),
                    `${cancelTarget.startTime}–${cancelTarget.endTime}`,
                  )
                : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{adminMessages.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={booking.isSaving}
              onClick={(event) => {
                event.preventDefault();
                if (!cancelTarget) return;
                void booking
                  .save((current) => {
                    const existing = current.lessonExceptions.find(
                      (exception) =>
                        exception.recurrenceRuleId ===
                          cancelTarget.recurrenceRuleId &&
                        exception.originalDate === cancelTarget.originalDate,
                    );
                    return upsertBookingLessonException(current, {
                      id: existing?.id ?? `exception-${crypto.randomUUID()}`,
                      recurrenceRuleId: cancelTarget.recurrenceRuleId,
                      originalDate: cancelTarget.originalDate,
                      kind: "cancelled",
                      updatedAt: new Date().toISOString(),
                    });
                  })
                  .then(() => {
                    setSuccessMessage(messages.lessonCancelled);
                    setCancelTarget(null);
                  })
                  .catch(() => {
                    // Keep the confirmation open with shared error feedback.
                  });
              }}
            >
              {booking.isSaving ? adminMessages.saving : messages.cancelLesson}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        onOpenChange={(open) => {
          if (!open) setRestoreTarget(null);
        }}
        open={restoreTarget !== null}
      >
        <AlertDialogContent data-testid="airhop-restore-lesson-dialog">
          <BookingFeedbackBanners />
          <AlertDialogHeader>
            <AlertDialogTitle>{messages.restoreLessonTitle}</AlertDialogTitle>
            <AlertDialogDescription>
              {messages.restoreLessonDescription}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{adminMessages.cancel}</AlertDialogCancel>
            <AlertDialogAction
              disabled={booking.isSaving}
              onClick={(event) => {
                event.preventDefault();
                if (!restoreTarget) return;
                void booking
                  .save((current) =>
                    restoreBookingLessonToSeries(
                      current,
                      restoreTarget.recurrenceRuleId,
                      restoreTarget.originalDate,
                    ),
                  )
                  .then(() => {
                    setSuccessMessage(messages.lessonRestored);
                    setRestoreTarget(null);
                  })
                  .catch(() => {
                    // Keep the confirmation open with shared error feedback.
                  });
              }}
            >
              {booking.isSaving ? adminMessages.saving : messages.restoreLesson}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export function ScheduleScreen() {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <BookingWorkspaceGate>
        {(workspace) => <ScheduleWorkspaceScreen workspace={workspace} />}
      </BookingWorkspaceGate>
    </div>
  );
}
