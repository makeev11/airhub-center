import * as React from "react";

import type {
  StaffLessonRosterEntry,
  StaffLessonService,
} from "@/features/booking/data/staffLessonService";
import { organizationLocalDateTime } from "@/features/booking/lib/bookingDateTime";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import type {
  BookingWorkspace,
  StableLessonReference,
  WeeklyScheduleSelection,
} from "@/features/booking/model/bookingCore";
import { BookingSelect } from "@/features/booking/ui/BookingSelect";
import { AirHopDateInput } from "@/features/booking/ui/AirHopDateInput";
import { WeeklySchedulePicker } from "@/features/booking/ui/WeeklySchedulePicker";
import { deriveWeeklySlotOptions } from "@/features/booking/ui/weeklySchedulePickerModel";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

type Step = "details" | "review";

function Field({
  children,
  error,
  label,
}: {
  children: React.ReactNode;
  error?: string;
  label: string;
}) {
  return (
    <div className="grid min-w-0 gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {error ? <span className="text-xs text-destructive">{error}</span> : null}
    </div>
  );
}

/** Server-backed permanent enrollment flow for one confirmed trial row. */
export function ServerEnrollmentDialog({
  entry,
  groupId,
  lessonRef,
  onOpenChange,
  onSaved,
  open,
  service,
  workspace,
}: {
  entry: StaffLessonRosterEntry | null;
  groupId: string | null;
  lessonRef: StableLessonReference | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
  service: StaffLessonService;
  workspace: BookingWorkspace;
}) {
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const formatters = createBookingFormatters(workspace.organization.locale);
  const [step, setStep] = React.useState<Step>("details");
  const [tariffId, setTariffId] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [schedule, setSchedule] = React.useState<WeeklyScheduleSelection[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setStep("details");
    setTariffId("");
    setStartDate(
      organizationLocalDateTime(workspace.organization.timeZone, new Date())
        .date,
    );
    setSchedule([]);
    setErrors({});
    setActionError(null);
  }, [open, workspace.organization.timeZone]);

  const tariffs = React.useMemo(
    () =>
      workspace.tariffs
        .filter((tariff) => tariff.status === "active")
        .sort((first, second) =>
          first.name.localeCompare(second.name, workspace.organization.locale),
        ),
    [workspace.organization.locale, workspace.tariffs],
  );
  const selectedTariff = tariffs.find((tariff) => tariff.id === tariffId);
  const selectedGroup = workspace.groups.find((group) => group.id === groupId);
  const slotOptions = React.useMemo(
    () =>
      groupId
        ? deriveWeeklySlotOptions(workspace, groupId).filter(
            (option) => !startDate || option.endsOn >= startDate,
          )
        : [],
    [groupId, startDate, workspace],
  );

  React.useEffect(() => {
    const available = new Set(
      slotOptions.map(
        (option) => `${option.recurrenceRuleId}:${option.weekday}`,
      ),
    );
    setSchedule((current) =>
      current.filter((selection) =>
        available.has(`${selection.recurrenceRuleId}:${selection.weekday}`),
      ),
    );
  }, [slotOptions]);

  if (!entry || !groupId || !lessonRef) return null;

  const review = () => {
    const nextErrors: Record<string, string> = {};
    if (!selectedTariff) nextErrors.tariff = messages.requiredField;
    if (!schedule.length) nextErrors.schedule = messages.requiredField;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      nextErrors.startDate = messages.requiredField;
    }
    if (
      selectedTariff &&
      schedule.length > selectedTariff.weeklyScheduleLimit
    ) {
      nextErrors.schedule = messages.enrollmentSlotLimitReached(
        selectedTariff.weeklyScheduleLimit,
      );
    }
    setErrors(nextErrors);
    if (!Object.keys(nextErrors).length) setStep("review");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (step === "details") {
      review();
      return;
    }
    if (!selectedTariff) {
      setStep("details");
      return;
    }
    setIsSaving(true);
    setActionError(null);
    try {
      await service.enrollTrial({
        lessonRef,
        childId: entry.childId,
        tariffId: selectedTariff.id,
        startDate,
        schedule,
      });
      onSaved();
      onOpenChange(false);
    } catch (cause) {
      setActionError(
        cause instanceof Error
          ? cause.message
          : messages.enrollmentActionFailed,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const slotLabel = (selection: WeeklyScheduleSelection) => {
    const option = slotOptions.find(
      (candidate) =>
        candidate.recurrenceRuleId === selection.recurrenceRuleId &&
        candidate.weekday === selection.weekday,
    );
    return `${formatters.weekdayName(selection.weekday)}${
      option ? `, ${option.startTime}–${option.endTime}` : ""
    }`;
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:w-full"
        data-testid="airhop-server-enrollment-dialog"
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-4 pr-12 text-left sm:px-6">
          <DialogTitle>
            {step === "details"
              ? messages.enrollChildTitle
              : messages.enrollmentReviewTitle}
          </DialogTitle>
          <DialogDescription>
            {step === "details"
              ? messages.enrollChildDescription
              : messages.enrollmentReviewDescription}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 flex-1 flex-col overflow-hidden"
          onSubmit={(event) => void submit(event)}
        >
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 sm:px-6">
            {actionError ? (
              <Alert variant="destructive">
                <AlertDescription>{actionError}</AlertDescription>
              </Alert>
            ) : null}
            {step === "details" ? (
              <>
                <Field label={messages.enrollmentExistingChild}>
                  <div className="rounded-xl border border-border/70 bg-muted/40 px-4 py-3">
                    <p className="font-medium">{entry.childName}</p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {entry.representativeName}
                    </p>
                  </div>
                </Field>
                <Field label={messages.enrollmentGroup}>
                  <div className="rounded-xl border border-border/70 bg-muted/40 px-4 py-3 font-medium">
                    {selectedGroup?.name ?? groupId}
                  </div>
                </Field>
                <Field error={errors.tariff} label={messages.enrollmentTariff}>
                  {tariffs.length ? (
                    <BookingSelect
                      data-testid="airhop-server-enrollment-tariff"
                      onChange={(event) => {
                        setTariffId(event.target.value);
                        setSchedule([]);
                      }}
                      value={tariffId}
                    >
                      <option value="">{messages.enrollmentTariff}</option>
                      {tariffs.map((tariff) => (
                        <option key={tariff.id} value={tariff.id}>
                          {tariff.name} ·{" "}
                          {formatters.money(tariff.priceMinor, tariff.currency)}
                        </option>
                      ))}
                    </BookingSelect>
                  ) : (
                    <Alert>
                      <AlertDescription>
                        {messages.enrollmentNoTariffs}
                      </AlertDescription>
                    </Alert>
                  )}
                </Field>
                <Field
                  error={errors.startDate}
                  label={messages.enrollmentStartDate}
                >
                  <AirHopDateInput
                    aria-label={messages.enrollmentStartDate}
                    data-testid="airhop-server-enrollment-start-date"
                    onChange={setStartDate}
                    value={startDate}
                  />
                </Field>
                {selectedTariff ? (
                  <Field
                    error={errors.schedule}
                    label={messages.enrollmentSchedule}
                  >
                    <WeeklySchedulePicker
                      locale={workspace.organization.locale}
                      maxSelections={selectedTariff.weeklyScheduleLimit}
                      onChange={setSchedule}
                      options={slotOptions}
                      value={schedule}
                    />
                  </Field>
                ) : null}
              </>
            ) : (
              <dl className="grid gap-4 rounded-xl border border-border/70 p-4 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {messages.enrollmentExistingChild}
                  </dt>
                  <dd className="mt-1 font-medium">{entry.childName}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {messages.enrollmentGroup}
                  </dt>
                  <dd className="mt-1 font-medium">{selectedGroup?.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {messages.enrollmentTariff}
                  </dt>
                  <dd className="mt-1 font-medium">{selectedTariff?.name}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted-foreground">
                    {messages.enrollmentStartDate}
                  </dt>
                  <dd className="mt-1 font-medium">
                    {formatters.date(startDate)}
                  </dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">
                    {messages.enrollmentSchedule}
                  </dt>
                  <dd className="mt-1 font-medium">
                    {schedule.map(slotLabel).join(" · ")}
                  </dd>
                </div>
                <div className="rounded-lg bg-muted/60 p-3 sm:col-span-2">
                  <dt className="text-xs text-muted-foreground">
                    {messages.enrollmentFirstPayment}
                  </dt>
                  <dd className="mt-1 font-semibold">
                    {selectedTariff
                      ? `${formatters.money(selectedTariff.priceMinor, selectedTariff.currency)} · ${formatters.date(startDate)}`
                      : ""}
                  </dd>
                </div>
              </dl>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-border/70 bg-background px-4 py-3 sm:px-6">
            {step === "details" ? (
              <>
                <Button
                  onClick={() => onOpenChange(false)}
                  type="button"
                  variant="outline"
                >
                  {messages.cancel}
                </Button>
                <Button
                  data-testid="airhop-server-enrollment-review"
                  type="submit"
                >
                  {messages.enrollmentContinue}
                </Button>
              </>
            ) : (
              <>
                <Button
                  onClick={() => setStep("details")}
                  type="button"
                  variant="outline"
                >
                  {messages.enrollmentBack}
                </Button>
                <Button
                  data-testid="airhop-server-enrollment-confirm"
                  disabled={isSaving}
                  type="submit"
                >
                  {isSaving ? messages.saving : messages.enrollmentConfirm}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
