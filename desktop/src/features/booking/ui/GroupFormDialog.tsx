import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import {
  currencyMinorUnitExponent,
  findGroupScheduleConflicts,
  majorMoneyInput,
  parseMajorMoneyInput,
  type GroupScheduleConflict,
} from "@/features/booking/lib/bookingAdmin";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  groupSchema,
  recurrenceRuleSchema,
  type BookingGroup,
  type BookingWorkspace,
  type RecurrenceRule,
} from "@/features/booking/model/bookingCore";
import {
  BookingEntityMutationError,
  upsertBookingGroup,
} from "@/features/booking/model/bookingMutations";
import { BookingSelect } from "@/features/booking/ui/BookingSelect";
import {
  type GroupScheduleTemplateForm,
  GroupScheduleEditor,
} from "@/features/booking/ui/GroupScheduleEditor";
import { BookingFeedbackBanners } from "@/features/booking/ui/BookingWorkspaceState";
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
import { Textarea } from "@/shared/ui/textarea";

type GroupForm = {
  id: string;
  name: string;
  description: string;
  branchId: string;
  roomId: string;
  teacherIds: string[];
  minAgeMonths: string;
  maxAgeMonths: string;
  capacity: string;
  trialMode: "inherit" | "disabled" | "free" | "paid";
  currency: string;
  price: string;
  attendance: "inherit" | "enabled" | "disabled";
  singleVisits: "inherit" | "enabled" | "disabled";
  schedules: GroupScheduleTemplateForm[];
};

type GroupFormErrors = Partial<
  Record<
    | "name"
    | "branch"
    | "room"
    | "minAge"
    | "maxAge"
    | "capacity"
    | "currency"
    | "price"
    | "schedule",
    string
  >
>;

function createGroupId(): string {
  return `group-${crypto.randomUUID()}`;
}

function createRuleId(): string {
  return `rule-${crypto.randomUUID()}`;
}

function isoDateInTimeZone(timeZone: string): string {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      day: "2-digit",
      month: "2-digit",
      timeZone,
      year: "numeric",
    })
      .formatToParts(new Date())
      .filter(({ type }) => ["year", "month", "day"].includes(type))
      .map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

function shiftIsoDate(date: string, days: number): string {
  const value = new Date(`${date}T12:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function defaultSchedule(timeZone: string): GroupScheduleTemplateForm {
  const startsOn = isoDateInTimeZone(timeZone);
  return {
    id: createRuleId(),
    weekdays: ["monday"],
    startsOn,
    endsOn: shiftIsoDate(startsOn, 90),
    startTime: "10:00",
    endTime: "11:00",
  };
}

function formFromGroup(
  workspace: BookingWorkspace,
  group: BookingGroup | null,
): GroupForm {
  const paidPolicy =
    group?.trialPolicyOverride?.mode === "paid"
      ? group.trialPolicyOverride
      : workspace.organization.defaultTrialPolicy.mode === "paid"
        ? workspace.organization.defaultTrialPolicy
        : null;
  const currency = paidPolicy?.price.currency ?? "RUB";
  const schedules = group
    ? workspace.recurrenceRules
        .filter((rule) => rule.groupId === group.id && rule.status === "active")
        .map((rule) => ({
          id: rule.id,
          weekdays: [...rule.weekdays],
          startsOn: rule.startsOn,
          endsOn: rule.endsOn,
          startTime: rule.startTime,
          endTime: rule.endTime,
        }))
    : [defaultSchedule(workspace.organization.timeZone)];
  return {
    id: group?.id ?? createGroupId(),
    name: group?.name ?? "",
    description: group?.description ?? "",
    branchId:
      group?.branchId ??
      workspace.branches.find((branch) => branch.status === "active")?.id ??
      "",
    roomId: group?.roomId ?? "",
    teacherIds: [...(group?.teacherIds ?? [])],
    minAgeMonths:
      group?.minAgeMonths === undefined ? "" : String(group.minAgeMonths),
    maxAgeMonths:
      group?.maxAgeMonths === undefined ? "" : String(group.maxAgeMonths),
    capacity: group?.capacity === undefined ? "" : String(group.capacity),
    trialMode: group?.trialPolicyOverride?.mode ?? "inherit",
    currency,
    price: majorMoneyInput(paidPolicy?.price.amountMinor ?? 0, currency),
    attendance:
      group?.trackAttendanceOverride === undefined
        ? "inherit"
        : group.trackAttendanceOverride
          ? "enabled"
          : "disabled",
    singleVisits:
      group?.allowSingleVisitsOverride === undefined
        ? "inherit"
        : group.allowSingleVisitsOverride
          ? "enabled"
          : "disabled",
    schedules,
  };
}

function optionalInteger(value: string, positive: boolean): number | undefined {
  if (!value.trim()) return undefined;
  if (!/^\d+$/.test(value.trim())) return Number.NaN;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && (!positive || parsed > 0)
    ? parsed
    : Number.NaN;
}

function Field({
  children,
  error,
  hint,
  label,
}: {
  children: React.ReactNode;
  error?: string;
  hint?: string;
  label: string;
}) {
  return (
    <div className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
      {!error && hint ? (
        <span className="text-xs text-muted-foreground">{hint}</span>
      ) : null}
    </div>
  );
}

function conflictLabel(
  conflict: GroupScheduleConflict,
  workspace: BookingWorkspace,
  messages: ReturnType<typeof getBookingAdminMessages>,
): string {
  const kind =
    conflict.kind === "outside-working-hours"
      ? messages.scheduleConflictWorkingHours
      : conflict.kind === "room"
        ? messages.scheduleConflictRoom
        : messages.scheduleConflictTeacher;
  const group = conflict.conflictingGroupId
    ? workspace.groups.find(
        (candidate) => candidate.id === conflict.conflictingGroupId,
      )
    : null;
  return [
    messages.weekdayNames[conflict.weekday],
    kind,
    ...(group ? [messages.scheduleConflictWithGroup(group.name)] : []),
  ].join(" · ");
}

function buildEntities(
  workspace: BookingWorkspace,
  freshGroup: BookingGroup | null,
  form: GroupForm,
): {
  group: BookingGroup | null;
  rules: RecurrenceRule[];
  errors: GroupFormErrors;
  scheduleErrors: Record<string, string>;
} {
  const errors: GroupFormErrors = {};
  const scheduleErrors: Record<string, string> = {};
  if (!form.name.trim()) errors.name = "required";
  if (!form.branchId) errors.branch = "required";
  const minAgeMonths = optionalInteger(form.minAgeMonths, false);
  const maxAgeMonths = optionalInteger(form.maxAgeMonths, false);
  const capacity = optionalInteger(form.capacity, true);
  if (Number.isNaN(minAgeMonths)) errors.minAge = "invalid";
  if (Number.isNaN(maxAgeMonths)) errors.maxAge = "invalid";
  if (Number.isNaN(capacity)) errors.capacity = "invalid";
  if (
    minAgeMonths !== undefined &&
    maxAgeMonths !== undefined &&
    minAgeMonths > maxAgeMonths
  ) {
    errors.minAge = "range";
    errors.maxAge = "range";
  }
  const room = form.roomId
    ? workspace.rooms.find((candidate) => candidate.id === form.roomId)
    : null;
  if (room && room.branchId !== form.branchId) errors.room = "invalid";

  const currency = form.currency.trim().toUpperCase();
  const currencyIsValid = currencyMinorUnitExponent(currency) !== null;
  const amountMinor =
    form.trialMode === "paid" && currencyIsValid
      ? parseMajorMoneyInput(form.price, currency)
      : null;
  if (form.trialMode === "paid" && !currencyIsValid) {
    errors.currency = "invalid";
  }
  if (form.trialMode === "paid" && currencyIsValid && amountMinor === null) {
    errors.price = "invalid";
  }

  const parsedGroup = groupSchema.safeParse({
    id: form.id,
    organizationId: workspace.organization.id,
    branchId: form.branchId,
    name: form.name,
    ...(form.description.trim()
      ? { description: form.description.trim() }
      : {}),
    ...(form.roomId ? { roomId: form.roomId } : {}),
    teacherIds: form.teacherIds,
    ...(minAgeMonths === undefined || Number.isNaN(minAgeMonths)
      ? {}
      : { minAgeMonths }),
    ...(maxAgeMonths === undefined || Number.isNaN(maxAgeMonths)
      ? {}
      : { maxAgeMonths }),
    ...(capacity === undefined || Number.isNaN(capacity) ? {} : { capacity }),
    ...(form.trialMode === "inherit"
      ? {}
      : form.trialMode === "paid"
        ? {
            trialPolicyOverride: {
              mode: "paid" as const,
              price: { amountMinor: amountMinor ?? 0, currency },
            },
          }
        : { trialPolicyOverride: { mode: form.trialMode } }),
    ...(form.attendance === "inherit"
      ? {}
      : { trackAttendanceOverride: form.attendance === "enabled" }),
    ...(form.singleVisits === "inherit"
      ? {}
      : { allowSingleVisitsOverride: form.singleVisits === "enabled" }),
    status: freshGroup?.status ?? "active",
  });

  if (!form.schedules.length) errors.schedule = "required";
  const existingRuleById = new Map(
    workspace.recurrenceRules.map((rule) => [rule.id, rule]),
  );
  const rules = form.schedules.flatMap((schedule) => {
    let error: "weekday" | "range" | "time" | undefined;
    if (!schedule.weekdays.length) error = "weekday";
    else if (
      !schedule.startsOn ||
      !schedule.endsOn ||
      schedule.startsOn > schedule.endsOn
    ) {
      error = "range";
    } else if (
      !schedule.startTime ||
      !schedule.endTime ||
      schedule.startTime >= schedule.endTime
    ) {
      error = "time";
    }
    const existing = existingRuleById.get(schedule.id);
    const parsed = recurrenceRuleSchema.safeParse({
      ...existing,
      id: schedule.id,
      organizationId: workspace.organization.id,
      groupId: form.id,
      startsOn: schedule.startsOn,
      endsOn: schedule.endsOn,
      weekdays: schedule.weekdays,
      startTime: schedule.startTime,
      endTime: schedule.endTime,
      status: "active",
    });
    if (error || !parsed.success) {
      scheduleErrors[schedule.id] = error ?? "invalid";
      return [];
    }
    return [parsed.data];
  });

  return {
    group: parsedGroup.success ? parsedGroup.data : null,
    rules,
    errors,
    scheduleErrors,
  };
}

export function GroupFormDialog({
  group,
  onOpenChange,
  onSaved,
  open,
}: {
  group: BookingGroup | null;
  onOpenChange: (open: boolean) => void;
  onSaved: (kind: "created" | "updated") => void;
  open: boolean;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace as BookingWorkspace;
  const messages = getBookingAdminMessages(
    workspace?.organization.locale ?? "ru-RU",
  );
  const freshGroup = group
    ? (workspace?.groups.find((candidate) => candidate.id === group.id) ?? null)
    : null;
  const [form, setForm] = React.useState<GroupForm>(() =>
    formFromGroup(workspace, group),
  );
  const [baseline, setBaseline] = React.useState<GroupForm | null>(null);
  const [errors, setErrors] = React.useState<GroupFormErrors>({});
  const [scheduleErrors, setScheduleErrors] = React.useState<
    Record<string, string>
  >({});
  const [conflictsConfirmed, setConflictsConfirmed] = React.useState(false);
  const [mutationError, setMutationError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    const fresh = formFromGroup(workspace, freshGroup);
    setForm(fresh);
    setBaseline(fresh);
    setErrors({});
    setScheduleErrors({});
    setConflictsConfirmed(false);
    setMutationError(null);
  }, [freshGroup, open, workspace]);

  const built = React.useMemo(
    () => buildEntities(workspace, freshGroup, form),
    [form, freshGroup, workspace],
  );
  const conflicts = React.useMemo(
    () =>
      built.group && built.rules.length === form.schedules.length
        ? findGroupScheduleConflicts(workspace, built.group, built.rules)
        : [],
    [built.group, built.rules, form.schedules.length, workspace],
  );
  const conflictLabels = [
    ...new Set(
      conflicts.map((conflict) => conflictLabel(conflict, workspace, messages)),
    ),
  ];
  const dirty =
    open &&
    baseline !== null &&
    JSON.stringify(form) !== JSON.stringify(baseline);
  useBookingUnsavedChangesGuard(dirty, messages.unsavedChangesConfirm);

  const updateForm = (update: (current: GroupForm) => GroupForm) => {
    setConflictsConfirmed(false);
    setMutationError(null);
    setForm(update);
  };

  const requestOpenChange = (nextOpen: boolean) => {
    if (nextOpen || !dirty || window.confirm(messages.unsavedChangesConfirm)) {
      onOpenChange(nextOpen);
    }
  };

  const localizeErrors = (next: typeof built) => {
    const localized: GroupFormErrors = {};
    if (next.errors.name === "required")
      localized.name = messages.requiredField;
    if (next.errors.branch === "required")
      localized.branch = messages.requiredField;
    if (next.errors.room) localized.room = messages.requiredField;
    if (next.errors.minAge === "invalid")
      localized.minAge = messages.invalidAge;
    if (next.errors.maxAge === "invalid")
      localized.maxAge = messages.invalidAge;
    if (next.errors.minAge === "range")
      localized.minAge = messages.invalidAgeRange;
    if (next.errors.maxAge === "range")
      localized.maxAge = messages.invalidAgeRange;
    if (next.errors.capacity) localized.capacity = messages.invalidCapacity;
    if (next.errors.currency) localized.currency = messages.invalidCurrency;
    if (next.errors.price) localized.price = messages.invalidPrice;
    if (next.errors.schedule) localized.schedule = messages.scheduleRequired;
    const localizedSchedules = Object.fromEntries(
      Object.entries(next.scheduleErrors).map(([id, kind]) => [
        id,
        kind === "weekday"
          ? messages.scheduleWeekdayRequired
          : kind === "range"
            ? messages.invalidScheduleRange
            : messages.invalidScheduleTime,
      ]),
    );
    setErrors(localized);
    setScheduleErrors(localizedSchedules);
    return (
      Object.keys(localized).length || Object.keys(localizedSchedules).length
    );
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      localizeErrors(built) ||
      !built.group ||
      built.rules.length !== form.schedules.length
    ) {
      return;
    }
    if (conflicts.length && !conflictsConfirmed) return;
    try {
      await booking.save((current) =>
        upsertBookingGroup(current, {
          group: built.group as BookingGroup,
          activeRules: built.rules,
        }),
      );
      onSaved(group ? "updated" : "created");
      onOpenChange(false);
    } catch (error) {
      if (
        error instanceof BookingEntityMutationError &&
        error.message.includes("cannot exclude booked occurrence")
      ) {
        setMutationError(messages.bookedOccurrenceRuleErrorDescription);
      }
      // The form stays open. Storage errors also remain in shared feedback.
    }
  };

  const activeBranches = workspace.branches.filter(
    (branch) =>
      branch.status === "active" || branch.id === freshGroup?.branchId,
  );
  const rooms = workspace.rooms.filter(
    (room) =>
      room.branchId === form.branchId &&
      (room.status === "active" || room.id === freshGroup?.roomId),
  );
  const teachers = workspace.teachers.filter(
    (teacher) =>
      teacher.status === "active" || form.teacherIds.includes(teacher.id),
  );

  return (
    <Dialog onOpenChange={requestOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[calc(100dvh-2rem)] max-w-5xl flex-col overflow-hidden p-0"
        data-testid="airhop-group-form"
      >
        <DialogHeader className="shrink-0 px-6 pt-6 pr-14">
          <DialogTitle>
            {group ? messages.editGroupTitle : messages.createGroupTitle}
          </DialogTitle>
          <DialogDescription>
            {group
              ? messages.editGroupDescription
              : messages.createGroupDescription}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onSubmit={(event) => void submit(event)}
        >
          <div className="min-h-0 space-y-5 overflow-y-auto px-6 py-2">
            <BookingFeedbackBanners />
            {mutationError ? (
              <Alert
                data-testid="airhop-group-booked-occurrence-error"
                variant="destructive"
              >
                <AlertTitle>
                  {messages.bookedOccurrenceRuleErrorTitle}
                </AlertTitle>
                <AlertDescription>{mutationError}</AlertDescription>
              </Alert>
            ) : null}
            <div className="grid gap-4 md:grid-cols-3">
              <Field error={errors.name} label={messages.groupName}>
                <Input
                  aria-label={messages.groupName}
                  data-testid="airhop-group-name"
                  maxLength={200}
                  onChange={(event) =>
                    updateForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  value={form.name}
                />
              </Field>
              <Field error={errors.branch} label={messages.groupBranch}>
                <BookingSelect
                  aria-label={messages.groupBranch}
                  data-testid="airhop-group-branch"
                  onChange={(event) =>
                    updateForm((current) => ({
                      ...current,
                      branchId: event.target.value,
                      roomId: "",
                    }))
                  }
                  value={form.branchId}
                >
                  <option value="">{messages.requiredField}</option>
                  {activeBranches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.status === "archived"
                        ? messages.archivedBranchOption(branch.name)
                        : branch.name}
                    </option>
                  ))}
                </BookingSelect>
              </Field>
            </div>
            <Field
              hint={messages.groupDescriptionHint}
              label={messages.groupDescription}
            >
              <Textarea
                aria-label={messages.groupDescription}
                maxLength={4_000}
                onChange={(event) =>
                  updateForm((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
                value={form.description}
              />
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field error={errors.room} label={messages.groupRoom}>
                <BookingSelect
                  aria-label={messages.groupRoom}
                  data-testid="airhop-group-room"
                  onChange={(event) =>
                    updateForm((current) => ({
                      ...current,
                      roomId: event.target.value,
                    }))
                  }
                  value={form.roomId}
                >
                  <option value="">{messages.noRoom}</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>
                      {room.status === "archived"
                        ? messages.archivedRoomOption(room.name)
                        : room.name}
                    </option>
                  ))}
                </BookingSelect>
              </Field>
              <Field
                hint={messages.capacityHint}
                label={messages.groupCapacity}
                error={errors.capacity}
              >
                <Input
                  aria-label={messages.groupCapacity}
                  data-testid="airhop-group-capacity"
                  inputMode="numeric"
                  min="1"
                  onChange={(event) =>
                    updateForm((current) => ({
                      ...current,
                      capacity: event.target.value,
                    }))
                  }
                  step="1"
                  type="number"
                  value={form.capacity}
                />
              </Field>
            </div>
            <div className="grid gap-4 md:grid-cols-2">
              <Field
                error={errors.minAge}
                hint={messages.ageMonthsHint}
                label={messages.groupMinAge}
              >
                <Input
                  aria-label={messages.groupMinAge}
                  data-testid="airhop-group-min-age"
                  inputMode="numeric"
                  min="0"
                  onChange={(event) =>
                    updateForm((current) => ({
                      ...current,
                      minAgeMonths: event.target.value,
                    }))
                  }
                  step="1"
                  type="number"
                  value={form.minAgeMonths}
                />
              </Field>
              <Field
                error={errors.maxAge}
                hint={messages.ageMonthsHint}
                label={messages.groupMaxAge}
              >
                <Input
                  aria-label={messages.groupMaxAge}
                  data-testid="airhop-group-max-age"
                  inputMode="numeric"
                  min="0"
                  onChange={(event) =>
                    updateForm((current) => ({
                      ...current,
                      maxAgeMonths: event.target.value,
                    }))
                  }
                  step="1"
                  type="number"
                  value={form.maxAgeMonths}
                />
              </Field>
            </div>
            <Field label={messages.groupTeachers}>
              <div className="max-h-40 space-y-2 overflow-y-auto rounded-xl border border-border/70 p-3">
                {teachers.length ? (
                  teachers.map((teacher) => (
                    <label
                      className="flex items-center gap-2 text-sm"
                      htmlFor={`group-teacher-${teacher.id}`}
                      key={teacher.id}
                    >
                      <Checkbox
                        aria-label={teacher.displayName}
                        checked={form.teacherIds.includes(teacher.id)}
                        id={`group-teacher-${teacher.id}`}
                        onCheckedChange={(checked) =>
                          updateForm((current) => ({
                            ...current,
                            teacherIds:
                              checked === true
                                ? [...current.teacherIds, teacher.id]
                                : current.teacherIds.filter(
                                    (candidate) => candidate !== teacher.id,
                                  ),
                          }))
                        }
                      />
                      <span>
                        {teacher.status === "archived"
                          ? messages.archivedTeacherOption(teacher.displayName)
                          : teacher.displayName}
                      </span>
                    </label>
                  ))
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {messages.noTeachers}
                  </p>
                )}
              </div>
            </Field>
            <div className="grid gap-4 md:grid-cols-2">
              <Field label={messages.groupTrialPolicy}>
                <BookingSelect
                  aria-label={messages.groupTrialPolicy}
                  data-testid="airhop-group-trial-policy"
                  onChange={(event) =>
                    updateForm((current) => ({
                      ...current,
                      trialMode: event.target.value as GroupForm["trialMode"],
                    }))
                  }
                  value={form.trialMode}
                >
                  <option value="inherit">
                    {messages.inheritCenterSetting}
                  </option>
                  <option value="disabled">{messages.trialDisabled}</option>
                  <option value="free">{messages.trialFree}</option>
                  <option value="paid">{messages.trialPaid}</option>
                </BookingSelect>
              </Field>
              <Field label={messages.groupAttendance}>
                <BookingSelect
                  aria-label={messages.groupAttendance}
                  data-testid="airhop-group-attendance"
                  onChange={(event) =>
                    updateForm((current) => ({
                      ...current,
                      attendance: event.target.value as GroupForm["attendance"],
                    }))
                  }
                  value={form.attendance}
                >
                  <option value="inherit">
                    {messages.inheritCenterSetting}
                  </option>
                  <option value="enabled">{messages.attendanceEnabled}</option>
                  <option value="disabled">
                    {messages.attendanceDisabled}
                  </option>
                </BookingSelect>
              </Field>
              <Field label={messages.groupSingleVisits}>
                <BookingSelect
                  aria-label={messages.groupSingleVisits}
                  data-testid="airhop-group-single-visits"
                  onChange={(event) =>
                    updateForm((current) => ({
                      ...current,
                      singleVisits: event.target
                        .value as GroupForm["singleVisits"],
                    }))
                  }
                  value={form.singleVisits}
                >
                  <option value="inherit">
                    {messages.inheritCenterSetting}
                  </option>
                  <option value="enabled">
                    {messages.singleVisitsEnabled}
                  </option>
                  <option value="disabled">
                    {messages.singleVisitsDisabled}
                  </option>
                </BookingSelect>
              </Field>
            </div>
            {form.trialMode === "paid" ? (
              <div className="grid gap-4 md:grid-cols-2">
                <Field error={errors.currency} label={messages.currency}>
                  <Input
                    aria-label={messages.currency}
                    maxLength={3}
                    onChange={(event) =>
                      updateForm((current) => ({
                        ...current,
                        currency: event.target.value.toUpperCase(),
                      }))
                    }
                    value={form.currency}
                  />
                </Field>
                <Field error={errors.price} label={messages.trialPrice}>
                  <Input
                    aria-label={messages.trialPrice}
                    inputMode="decimal"
                    onChange={(event) =>
                      updateForm((current) => ({
                        ...current,
                        price: event.target.value,
                      }))
                    }
                    value={form.price}
                  />
                </Field>
              </div>
            ) : null}
            <GroupScheduleEditor
              errors={scheduleErrors}
              locale={workspace.organization.locale}
              messages={messages}
              onAdd={() =>
                updateForm((current) => ({
                  ...current,
                  schedules: [
                    ...current.schedules,
                    defaultSchedule(workspace.organization.timeZone),
                  ],
                }))
              }
              onChange={(id, update) =>
                updateForm((current) => ({
                  ...current,
                  schedules: current.schedules.map((schedule) =>
                    schedule.id === id ? { ...schedule, ...update } : schedule,
                  ),
                }))
              }
              onRemove={(id) =>
                updateForm((current) => ({
                  ...current,
                  schedules: current.schedules.filter(
                    (schedule) => schedule.id !== id,
                  ),
                }))
              }
              value={form.schedules}
            />
            {errors.schedule ? (
              <p className="text-sm text-destructive">{errors.schedule}</p>
            ) : null}
            {conflicts.length ? (
              <Alert data-testid="airhop-group-schedule-conflicts">
                <AlertTitle>{messages.scheduleConflictTitle}</AlertTitle>
                <AlertDescription className="space-y-3">
                  <p>{messages.scheduleConflictDescription}</p>
                  <ul className="list-disc space-y-1 pl-5">
                    {conflictLabels.map((label) => (
                      <li key={label}>{label}</li>
                    ))}
                  </ul>
                  <label
                    className="flex items-center gap-2 font-medium"
                    htmlFor="group-conflicts-confirmed"
                  >
                    <Checkbox
                      aria-label={messages.scheduleConflictConfirmation}
                      checked={conflictsConfirmed}
                      id="group-conflicts-confirmed"
                      onCheckedChange={(checked) =>
                        setConflictsConfirmed(checked === true)
                      }
                    />
                    {messages.scheduleConflictConfirmation}
                  </label>
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
              {messages.cancel}
            </Button>
            <Button
              disabled={
                booking.isSaving ||
                !dirty ||
                (conflicts.length > 0 && !conflictsConfirmed)
              }
              type="submit"
            >
              {booking.isSaving ? messages.saving : messages.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
