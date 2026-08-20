import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import {
  currencyMinorUnitExponent,
  findLessonScheduleConflicts,
  getLessonSeriesValues,
  majorMoneyInput,
  parseMajorMoneyInput,
} from "@/features/booking/lib/bookingAdmin";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  createBookingFormatters,
  getBookingMessages,
} from "@/features/booking/lib/bookingLocale";
import {
  isoDateSchema,
  localTimeSchema,
  type LessonException,
  type TrialPolicy,
} from "@/features/booking/model/bookingCore";
import type { ScheduleLesson } from "@/features/booking/model/demoSchedule";
import { materializeScheduleOccurrence } from "@/features/booking/model/materializeSchedule";
import {
  restoreBookingLessonToSeries,
  upsertBookingLessonException,
} from "@/features/booking/model/bookingMutations";
import { BookingFeedbackBanners } from "@/features/booking/ui/BookingWorkspaceState";
import { AirHopDateInput } from "@/features/booking/ui/AirHopDateInput";
import { BookingSelect } from "@/features/booking/ui/BookingSelect";
import { useBookingUnsavedChangesGuard } from "@/features/booking/ui/useBookingUnsavedChangesGuard";
import { Alert, AlertDescription, AlertTitle } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Checkbox } from "@/shared/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Input } from "@/shared/ui/input";
type LessonForm = {
  date: string;
  startTime: string;
  endTime: string;
  branchId: string;
  roomId: string;
  teacherIds: string[];
  capacityMode: "inherit" | "unlimited" | "limited";
  capacityLimit: string;
  trialMode: "inherit" | TrialPolicy["mode"];
  trialCurrency: string;
  trialPrice: string;
  singleVisits: "inherit" | "enabled" | "disabled";
};
type LessonFormErrors = Partial<
  Record<
    "date" | "time" | "branch" | "room" | "capacity" | "currency" | "price",
    string
  >
>;
function sortedIds(values: readonly string[]): string[] {
  return [...values].sort((left, right) => left.localeCompare(right));
}
function sameIds(first: readonly string[], second: readonly string[]): boolean {
  return JSON.stringify(sortedIds(first)) === JSON.stringify(sortedIds(second));
}
function positiveInteger(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}
function field({
  children,
  error,
  label,
}: {
  children: React.ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <div className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}
function formFromLesson(
  workspace: NonNullable<ReturnType<typeof useBookingWorkspace>["workspace"]>,
  lesson: ScheduleLesson,
): LessonForm {
  const occurrence = materializeScheduleOccurrence(
    workspace,
    lesson.recurrenceRuleId,
    lesson.originalDate,
  );
  const exception = workspace.lessonExceptions.find(
    (candidate) =>
      candidate.recurrenceRuleId === lesson.recurrenceRuleId &&
      candidate.originalDate === lesson.originalDate,
  );
  const override = exception?.kind === "override" ? exception.override : null;
  const hasCapacityOverride = Boolean(
    override && Object.hasOwn(override, "capacity"),
  );
  const effectiveTrialPolicy =
    occurrence?.trialPolicy ?? workspace.organization.defaultTrialPolicy;
  const paidPolicy =
    override?.trialPolicy?.mode === "paid"
      ? override.trialPolicy
      : effectiveTrialPolicy.mode === "paid"
        ? effectiveTrialPolicy
        : workspace.organization.defaultTrialPolicy.mode === "paid"
          ? workspace.organization.defaultTrialPolicy
          : null;
  const trialCurrency = paidPolicy?.price.currency ?? "RUB";
  return {
    date: occurrence?.date ?? lesson.date,
    startTime: occurrence?.startTime ?? lesson.startTime,
    endTime: occurrence?.endTime ?? lesson.endTime,
    branchId: occurrence?.branchId ?? lesson.branchId,
    roomId: occurrence?.roomId ?? lesson.roomId ?? "",
    teacherIds: [...(occurrence?.teacherIds ?? lesson.teacherIds)],
    capacityMode: hasCapacityOverride
      ? override?.capacity === null
        ? "unlimited"
        : "limited"
      : "inherit",
    capacityLimit:
      override?.capacity === null
        ? occurrence?.capacity === undefined
          ? ""
          : String(occurrence.capacity)
        : String(override?.capacity ?? occurrence?.capacity ?? ""),
    trialMode: override?.trialPolicy?.mode ?? "inherit",
    trialCurrency,
    trialPrice: majorMoneyInput(
      paidPolicy?.price.amountMinor ?? 0,
      trialCurrency,
    ),
    singleVisits:
      override?.allowSingleVisits === undefined
        ? "inherit"
        : override.allowSingleVisits
          ? "enabled"
          : "disabled",
  };
}
export function LessonEditDialog({
  lesson,
  onOpenChange,
  onSaved,
  open,
}: {
  lesson: ScheduleLesson | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace;
  const workspaceRef = React.useRef(workspace);
  workspaceRef.current = workspace;
  const locale = workspace?.organization.locale ?? "ru-RU";
  const messages = getBookingMessages(locale);
  const adminMessages = getBookingAdminMessages(locale);
  const formatters = React.useMemo(
    () => createBookingFormatters(locale),
    [locale],
  );
  const [form, setForm] = React.useState<LessonForm | null>(null);
  const [baseline, setBaseline] = React.useState<LessonForm | null>(null);
  const [errors, setErrors] = React.useState<LessonFormErrors>({});
  const [conflictsConfirmed, setConflictsConfirmed] = React.useState(false);
  const recurrenceRuleId = lesson?.recurrenceRuleId;
  const originalDate = lesson?.originalDate;
  React.useEffect(() => {
    if (!open || !lesson || !workspaceRef.current) return;
    const fresh = formFromLesson(workspaceRef.current, lesson);
    setForm(fresh);
    setBaseline(fresh);
    setErrors({});
    setConflictsConfirmed(false);
  }, [lesson, open]);

  const dirty =
    open &&
    form !== null &&
    baseline !== null &&
    JSON.stringify(form) !== JSON.stringify(baseline);
  useBookingUnsavedChangesGuard(dirty, adminMessages.unsavedChangesConfirm);
  if (
    !workspace ||
    !lesson ||
    !form ||
    !baseline ||
    !recurrenceRuleId ||
    !originalDate
  ) {
    return null;
  }

  const series = getLessonSeriesValues(
    workspace,
    recurrenceRuleId,
    originalDate,
  );
  if (!series) return null;
  const branchById = new Map(
    workspace.branches.map((branch) => [branch.id, branch]),
  );
  const roomById = new Map(workspace.rooms.map((room) => [room.id, room]));
  const teacherById = new Map(
    workspace.teachers.map((teacher) => [teacher.id, teacher]),
  );
  const validDate = isoDateSchema.safeParse(form.date).success;
  const validTimes =
    localTimeSchema.safeParse(form.startTime).success &&
    localTimeSchema.safeParse(form.endTime).success &&
    form.startTime < form.endTime;
  const selectedRoom = form.roomId ? roomById.get(form.roomId) : undefined;
  const validRoom = !selectedRoom || selectedRoom.branchId === form.branchId;
  const validBranch = branchById.has(form.branchId);
  const validTeachers = form.teacherIds.every((id) => teacherById.has(id));
  const capacityLimit =
    form.capacityMode === "limited"
      ? positiveInteger(form.capacityLimit)
      : null;
  const validCapacity =
    form.capacityMode !== "limited" || capacityLimit !== null;
  const trialCurrency = form.trialCurrency.trim().toUpperCase();
  const validTrialCurrency =
    form.trialMode !== "paid" ||
    currencyMinorUnitExponent(trialCurrency) !== null;
  const trialAmountMinor =
    form.trialMode === "paid" && validTrialCurrency
      ? parseMajorMoneyInput(form.trialPrice, trialCurrency)
      : null;
  const validTrialPrice =
    form.trialMode !== "paid" || trialAmountMinor !== null;
  const candidate =
    validDate && validTimes && validRoom && validBranch && validTeachers
      ? {
          recurrenceRuleId,
          originalDate,
          date: form.date,
          startTime: form.startTime,
          endTime: form.endTime,
          branchId: form.branchId,
          ...(form.roomId ? { roomId: form.roomId } : {}),
          teacherIds: form.teacherIds,
        }
      : null;
  const conflicts = candidate
    ? findLessonScheduleConflicts(workspace, candidate)
    : [];
  const branches = workspace.branches.filter(
    (branch) =>
      branch.status === "active" ||
      branch.id === form.branchId ||
      branch.id === series.branchId,
  );
  const rooms = workspace.rooms.filter(
    (room) =>
      room.branchId === form.branchId &&
      (room.status === "active" || room.id === form.roomId),
  );
  const teachers = workspace.teachers.filter(
    (teacher) =>
      teacher.status === "active" || form.teacherIds.includes(teacher.id),
  );

  const branchName = (id: string) => branchById.get(id)?.name ?? id;
  const roomName = (id?: string) =>
    id ? (roomById.get(id)?.name ?? id) : adminMessages.noRoom;
  const teacherNames = (ids: readonly string[]) =>
    ids.length
      ? ids.map((id) => teacherById.get(id)?.displayName ?? id).join(", ")
      : adminMessages.noTeachers;
  const effectiveCapacity = (
    value: LessonForm,
    parsedLimit: number | null,
  ): number | undefined => {
    if (value.capacityMode === "inherit") return series.capacity;
    if (value.capacityMode === "unlimited") return undefined;
    return parsedLimit ?? undefined;
  };
  const trialPolicy = (
    value: LessonForm,
    amountMinor: number | null,
  ): TrialPolicy => {
    if (value.trialMode === "inherit") return series.trialPolicy;
    if (value.trialMode !== "paid") return { mode: value.trialMode };
    return {
      mode: "paid",
      price: {
        amountMinor: amountMinor ?? 0,
        currency:
          currencyMinorUnitExponent(
            value.trialCurrency.trim().toUpperCase(),
          ) !== null
            ? value.trialCurrency.trim().toUpperCase()
            : "RUB",
      },
    };
  };
  const capacityValueLabel = (value?: number) =>
    value === undefined
      ? messages.lessonCapacityUnlimited
      : messages.lessonCapacityValue(value);
  const capacitySelectionLabel = (
    value: LessonForm,
    parsedLimit: number | null,
  ) => {
    if (value.capacityMode === "limited" && parsedLimit === null) {
      return value.capacityLimit.trim() || messages.lessonCapacityLimited;
    }
    const label = capacityValueLabel(effectiveCapacity(value, parsedLimit));
    return value.capacityMode === "inherit"
      ? messages.lessonInheritedValue(label)
      : label;
  };
  const trialValueLabel = (policy: TrialPolicy) =>
    policy.mode === "disabled"
      ? adminMessages.trialDisabled
      : policy.mode === "free"
        ? adminMessages.trialFree
        : `${adminMessages.trialPaid} · ${formatters.money(
            policy.price.amountMinor,
            policy.price.currency,
          )}`;
  const trialSelectionLabel = (
    value: LessonForm,
    amountMinor: number | null,
  ) => {
    if (value.trialMode === "paid" && amountMinor === null) {
      return `${adminMessages.trialPaid} · ${value.trialCurrency || adminMessages.currency} · ${value.trialPrice || adminMessages.trialPrice}`;
    }
    const label = trialValueLabel(trialPolicy(value, amountMinor));
    return value.trialMode === "inherit"
      ? messages.lessonInheritedValue(label)
      : label;
  };
  const singleVisitSelectionLabel = (value: LessonForm) => {
    const allowed =
      value.singleVisits === "inherit"
        ? series.singleVisitAllowed
        : value.singleVisits === "enabled";
    const label = allowed
      ? adminMessages.singleVisitsEnabled
      : adminMessages.singleVisitsDisabled;
    return value.singleVisits === "inherit"
      ? messages.lessonInheritedValue(label)
      : label;
  };
  const baselineCapacityLimit =
    baseline.capacityMode === "limited"
      ? positiveInteger(baseline.capacityLimit)
      : null;
  const baselineTrialCurrency = baseline.trialCurrency.trim().toUpperCase();
  const baselineTrialAmount =
    baseline.trialMode === "paid"
      ? parseMajorMoneyInput(baseline.trialPrice, baselineTrialCurrency)
      : null;
  const changes: string[] = [];
  if (form.date !== baseline.date) {
    changes.push(
      messages.lessonChangeDate(
        formatters.date(baseline.date),
        validDate ? formatters.date(form.date) : form.date,
      ),
    );
  }
  if (
    form.startTime !== baseline.startTime ||
    form.endTime !== baseline.endTime
  ) {
    changes.push(
      messages.lessonChangeTime(
        `${baseline.startTime}–${baseline.endTime}`,
        `${form.startTime}–${form.endTime}`,
      ),
    );
  }
  if (form.branchId !== baseline.branchId) {
    changes.push(
      messages.lessonChangeBranch(
        branchName(baseline.branchId),
        branchName(form.branchId),
      ),
    );
  }
  if (form.roomId !== baseline.roomId) {
    changes.push(
      messages.lessonChangeRoom(
        roomName(baseline.roomId),
        roomName(form.roomId),
      ),
    );
  }
  if (!sameIds(form.teacherIds, baseline.teacherIds)) {
    changes.push(
      messages.lessonChangeTeachers(
        teacherNames(baseline.teacherIds),
        teacherNames(form.teacherIds),
      ),
    );
  }
  if (
    form.capacityMode !== baseline.capacityMode ||
    (form.capacityMode === "limited" &&
      form.capacityLimit.trim() !== baseline.capacityLimit.trim())
  ) {
    changes.push(
      messages.lessonChangeCapacity(
        capacitySelectionLabel(baseline, baselineCapacityLimit),
        capacitySelectionLabel(form, capacityLimit),
      ),
    );
  }
  if (
    form.trialMode !== baseline.trialMode ||
    (form.trialMode === "paid" &&
      (form.trialCurrency.trim().toUpperCase() !== baselineTrialCurrency ||
        form.trialPrice.trim() !== baseline.trialPrice.trim()))
  ) {
    changes.push(
      messages.lessonChangeTrial(
        trialSelectionLabel(baseline, baselineTrialAmount),
        trialSelectionLabel(form, trialAmountMinor),
      ),
    );
  }
  if (form.singleVisits !== baseline.singleVisits) {
    changes.push(
      adminMessages.lessonChangeSingleVisits(
        singleVisitSelectionLabel(baseline),
        singleVisitSelectionLabel(form),
      ),
    );
  }

  const requestOpenChange = (nextOpen: boolean) => {
    if (
      nextOpen ||
      !dirty ||
      window.confirm(adminMessages.unsavedChangesConfirm)
    ) {
      onOpenChange(nextOpen);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const nextErrors: LessonFormErrors = {};
    if (!validDate) nextErrors.date = adminMessages.requiredField;
    if (!validTimes) nextErrors.time = adminMessages.invalidScheduleTime;
    if (!validBranch) nextErrors.branch = adminMessages.requiredField;
    if (!validRoom) nextErrors.room = adminMessages.requiredField;
    if (!validCapacity) nextErrors.capacity = adminMessages.invalidCapacity;
    if (!validTrialCurrency) {
      nextErrors.currency = adminMessages.invalidCurrency;
    }
    if (!validTrialPrice) nextErrors.price = adminMessages.invalidPrice;
    if (Object.keys(nextErrors).length || !candidate || !changes.length) {
      setErrors(nextErrors);
      return;
    }
    if (conflicts.length && !conflictsConfirmed) return;
    const override: Extract<LessonException, { kind: "override" }>["override"] =
      {};
    if (form.date !== series.originalDate) override.date = form.date;
    if (form.startTime !== series.startTime)
      override.startTime = form.startTime;
    if (form.endTime !== series.endTime) override.endTime = form.endTime;
    if (form.branchId !== series.branchId) override.branchId = form.branchId;
    if ((form.roomId || undefined) !== series.roomId) {
      override.roomId = form.roomId || null;
    }
    if (!sameIds(form.teacherIds, series.teacherIds)) {
      override.teacherIds = form.teacherIds;
    }
    if (form.capacityMode === "unlimited") override.capacity = null;
    if (form.capacityMode === "limited" && capacityLimit !== null) {
      override.capacity = capacityLimit;
    }
    if (form.trialMode === "paid" && trialAmountMinor !== null) {
      override.trialPolicy = {
        mode: "paid",
        price: {
          amountMinor: trialAmountMinor,
          currency: trialCurrency,
        },
      };
    } else if (form.trialMode === "disabled" || form.trialMode === "free") {
      override.trialPolicy = { mode: form.trialMode };
    }
    if (form.singleVisits !== "inherit") {
      override.allowSingleVisits = form.singleVisits === "enabled";
    }
    try {
      await booking.save((current) => {
        if (!Object.keys(override).length) {
          return restoreBookingLessonToSeries(
            current,
            recurrenceRuleId,
            originalDate,
          );
        }
        const existing = current.lessonExceptions.find(
          (exception) =>
            exception.recurrenceRuleId === recurrenceRuleId &&
            exception.originalDate === originalDate,
        );
        return upsertBookingLessonException(current, {
          id: existing?.id ?? `exception-${crypto.randomUUID()}`,
          recurrenceRuleId,
          originalDate,
          kind: "override",
          override,
        });
      });
      onSaved();
      onOpenChange(false);
    } catch {
      // Keep the draft open after storage and revision failures.
    }
  };

  return (
    <Dialog onOpenChange={requestOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] max-w-3xl flex-col overflow-hidden p-0"
        data-testid="airhop-lesson-edit-dialog"
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pr-14">
          <DialogTitle>{messages.editLessonTitle}</DialogTitle>
          <DialogDescription>
            {messages.editLessonDescription}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onSubmit={(event) => void submit(event)}
        >
          <div
            className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-6 py-2"
            data-testid="airhop-lesson-edit-scroll"
          >
            <BookingFeedbackBanners />
            <div className="grid gap-4 sm:grid-cols-3">
              {field({
                label: messages.lessonDate,
                error: errors.date,
                children: (
                  <AirHopDateInput
                    aria-label={messages.lessonDate}
                    data-testid="airhop-lesson-date"
                    onChange={(value) => {
                      setConflictsConfirmed(false);
                      setForm((current) =>
                        current ? { ...current, date: value } : current,
                      );
                    }}
                    value={form.date}
                  />
                ),
              })}
              {field({
                label: messages.lessonStartTime,
                error: errors.time,
                children: (
                  <Input
                    aria-label={messages.lessonStartTime}
                    data-testid="airhop-lesson-start-time"
                    onChange={(event) => {
                      setConflictsConfirmed(false);
                      setForm((current) =>
                        current
                          ? { ...current, startTime: event.target.value }
                          : current,
                      );
                    }}
                    type="time"
                    value={form.startTime}
                  />
                ),
              })}
              {field({
                label: messages.lessonEndTime,
                error: errors.time,
                children: (
                  <Input
                    aria-label={messages.lessonEndTime}
                    data-testid="airhop-lesson-end-time"
                    onChange={(event) => {
                      setConflictsConfirmed(false);
                      setForm((current) =>
                        current
                          ? { ...current, endTime: event.target.value }
                          : current,
                      );
                    }}
                    type="time"
                    value={form.endTime}
                  />
                ),
              })}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              {field({
                label: adminMessages.groupBranch,
                error: errors.branch,
                children: (
                  <BookingSelect
                    aria-label={adminMessages.groupBranch}
                    data-testid="airhop-lesson-branch"
                    onChange={(event) => {
                      setConflictsConfirmed(false);
                      setForm((current) =>
                        current
                          ? {
                              ...current,
                              branchId: event.target.value,
                              roomId: "",
                            }
                          : current,
                      );
                    }}
                    value={form.branchId}
                  >
                    {branches.map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.status === "archived"
                          ? adminMessages.archivedBranchOption(branch.name)
                          : branch.name}
                      </option>
                    ))}
                  </BookingSelect>
                ),
              })}
              {field({
                label: adminMessages.groupRoom,
                error: errors.room,
                children: (
                  <BookingSelect
                    aria-label={adminMessages.groupRoom}
                    data-testid="airhop-lesson-room"
                    onChange={(event) => {
                      setConflictsConfirmed(false);
                      setForm((current) =>
                        current
                          ? { ...current, roomId: event.target.value }
                          : current,
                      );
                    }}
                    value={form.roomId}
                  >
                    <option value="">{adminMessages.noRoom}</option>
                    {rooms.map((room) => (
                      <option key={room.id} value={room.id}>
                        {room.status === "archived"
                          ? adminMessages.archivedRoomOption(room.name)
                          : room.name}
                      </option>
                    ))}
                  </BookingSelect>
                ),
              })}
            </div>
            <div className="grid gap-2 text-sm">
              <span className="font-medium">{adminMessages.groupTeachers}</span>
              <div className="max-h-44 space-y-2 overflow-y-auto rounded-xl border border-border/70 p-3">
                {teachers.length ? (
                  teachers.map((teacher) => (
                    <div className="flex items-center gap-2" key={teacher.id}>
                      <Checkbox
                        aria-label={teacher.displayName}
                        checked={form.teacherIds.includes(teacher.id)}
                        onCheckedChange={(checked) => {
                          setConflictsConfirmed(false);
                          setForm((current) => {
                            if (!current) return current;
                            return {
                              ...current,
                              teacherIds: checked
                                ? [...current.teacherIds, teacher.id]
                                : current.teacherIds.filter(
                                    (id) => id !== teacher.id,
                                  ),
                            };
                          });
                        }}
                      />
                      <span aria-hidden="true">
                        {teacher.status === "archived"
                          ? adminMessages.archivedTeacherOption(
                              teacher.displayName,
                            )
                          : teacher.displayName}
                      </span>
                    </div>
                  ))
                ) : (
                  <p className="text-muted-foreground">
                    {adminMessages.noTeachers}
                  </p>
                )}
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {field({
                label: messages.lessonCapacity,
                children: (
                  <BookingSelect
                    aria-label={messages.lessonCapacity}
                    data-testid="airhop-lesson-capacity-mode"
                    onChange={(event) => {
                      setErrors((current) => ({
                        ...current,
                        capacity: undefined,
                      }));
                      setForm((current) =>
                        current
                          ? {
                              ...current,
                              capacityMode: event.target
                                .value as LessonForm["capacityMode"],
                            }
                          : current,
                      );
                    }}
                    value={form.capacityMode}
                  >
                    <option value="inherit">
                      {messages.lessonCapacityInherit}
                    </option>
                    <option value="unlimited">
                      {messages.lessonCapacityUnlimited}
                    </option>
                    <option value="limited">
                      {messages.lessonCapacityLimited}
                    </option>
                  </BookingSelect>
                ),
              })}
              {field({
                label: messages.lessonTrialPolicy,
                children: (
                  <BookingSelect
                    aria-label={messages.lessonTrialPolicy}
                    data-testid="airhop-lesson-trial-policy"
                    onChange={(event) => {
                      setErrors((current) => ({
                        ...current,
                        currency: undefined,
                        price: undefined,
                      }));
                      setForm((current) =>
                        current
                          ? {
                              ...current,
                              trialMode: event.target
                                .value as LessonForm["trialMode"],
                            }
                          : current,
                      );
                    }}
                    value={form.trialMode}
                  >
                    <option value="inherit">
                      {messages.lessonTrialInherit}
                    </option>
                    <option value="disabled">
                      {adminMessages.trialDisabled}
                    </option>
                    <option value="free">{adminMessages.trialFree}</option>
                    <option value="paid">{adminMessages.trialPaid}</option>
                  </BookingSelect>
                ),
              })}
              {field({
                label: adminMessages.groupSingleVisits,
                children: (
                  <BookingSelect
                    aria-label={adminMessages.groupSingleVisits}
                    data-testid="airhop-lesson-single-visits"
                    onChange={(event) =>
                      setForm((current) =>
                        current
                          ? {
                              ...current,
                              singleVisits: event.target
                                .value as LessonForm["singleVisits"],
                            }
                          : current,
                      )
                    }
                    value={form.singleVisits}
                  >
                    <option value="inherit">
                      {adminMessages.inheritGroupSetting}
                    </option>
                    <option value="enabled">
                      {adminMessages.singleVisitsEnabled}
                    </option>
                    <option value="disabled">
                      {adminMessages.singleVisitsDisabled}
                    </option>
                  </BookingSelect>
                ),
              })}
            </div>
            {form.capacityMode === "limited" || form.trialMode === "paid" ? (
              <div className="grid gap-4 sm:grid-cols-2">
                {form.capacityMode === "limited"
                  ? field({
                      label: messages.lessonCapacityLimit,
                      error: errors.capacity,
                      children: (
                        <Input
                          aria-label={messages.lessonCapacityLimit}
                          data-testid="airhop-lesson-capacity-limit"
                          inputMode="numeric"
                          min={1}
                          onChange={(event) => {
                            setErrors((current) => ({
                              ...current,
                              capacity: undefined,
                            }));
                            setForm((current) =>
                              current
                                ? {
                                    ...current,
                                    capacityLimit: event.target.value,
                                  }
                                : current,
                            );
                          }}
                          step={1}
                          type="number"
                          value={form.capacityLimit}
                        />
                      ),
                    })
                  : null}
                {form.trialMode === "paid" ? (
                  <div className="grid gap-4 sm:col-span-2 sm:grid-cols-2">
                    {field({
                      label: adminMessages.currency,
                      error: errors.currency,
                      children: (
                        <Input
                          aria-label={adminMessages.currency}
                          data-testid="airhop-lesson-trial-currency"
                          maxLength={3}
                          onChange={(event) => {
                            setErrors((current) => ({
                              ...current,
                              currency: undefined,
                            }));
                            setForm((current) =>
                              current
                                ? {
                                    ...current,
                                    trialCurrency:
                                      event.target.value.toUpperCase(),
                                  }
                                : current,
                            );
                          }}
                          value={form.trialCurrency}
                        />
                      ),
                    })}
                    {field({
                      label: adminMessages.trialPrice,
                      error: errors.price,
                      children: (
                        <Input
                          aria-label={adminMessages.trialPrice}
                          data-testid="airhop-lesson-trial-price"
                          inputMode="decimal"
                          onChange={(event) => {
                            setErrors((current) => ({
                              ...current,
                              price: undefined,
                            }));
                            setForm((current) =>
                              current
                                ? {
                                    ...current,
                                    trialPrice: event.target.value,
                                  }
                                : current,
                            );
                          }}
                          value={form.trialPrice}
                        />
                      ),
                    })}
                  </div>
                ) : null}
              </div>
            ) : null}
            <Alert data-testid="airhop-lesson-change-preview">
              <AlertTitle>{messages.lessonPreviewTitle}</AlertTitle>
              <AlertDescription className="space-y-2">
                <p>{messages.lessonOneOccurrenceOnly}</p>
                {changes.length ? (
                  <ul className="list-disc space-y-1 pl-5">
                    {changes.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{messages.lessonNoChanges}</p>
                )}
              </AlertDescription>
            </Alert>
            {conflicts.length ? (
              <Alert data-testid="airhop-lesson-conflicts">
                <AlertTitle>{messages.lessonConflictTitle}</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>{messages.lessonConflictDescription}</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {conflicts.map((conflict) => {
                      const label =
                        conflict.kind === "outside-working-hours"
                          ? adminMessages.scheduleConflictWorkingHours
                          : conflict.kind === "room"
                            ? adminMessages.scheduleConflictRoom
                            : adminMessages.scheduleConflictTeacher;
                      const group = conflict.conflictingGroupId
                        ? workspace.groups.find(
                            (candidate) =>
                              candidate.id === conflict.conflictingGroupId,
                          )
                        : null;
                      return (
                        <li
                          key={`${conflict.kind}-${conflict.conflictingRuleId ?? "working-hours"}-${conflict.conflictingOriginalDate ?? "none"}-${conflict.teacherIds?.join(",") ?? "none"}`}
                        >
                          {label}
                          {group
                            ? ` · ${adminMessages.scheduleConflictWithGroup(group.name)}`
                            : ""}
                        </li>
                      );
                    })}
                  </ul>
                  <div className="flex items-start gap-2">
                    <Checkbox
                      aria-label={messages.lessonConflictConfirmation}
                      checked={conflictsConfirmed}
                      onCheckedChange={(checked) =>
                        setConflictsConfirmed(checked === true)
                      }
                    />
                    <span aria-hidden="true">
                      {messages.lessonConflictConfirmation}
                    </span>
                  </div>
                </AlertDescription>
              </Alert>
            ) : null}
          </div>
          <DialogFooter className="shrink-0 border-t border-border/70 px-6 py-4">
            <Button
              onClick={() => requestOpenChange(false)}
              type="button"
              variant="outline"
            >
              {adminMessages.cancel}
            </Button>
            <Button
              disabled={
                booking.isSaving ||
                !dirty ||
                !changes.length ||
                (conflicts.length > 0 && !conflictsConfirmed)
              }
              type="submit"
            >
              {booking.isSaving ? adminMessages.saving : adminMessages.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
