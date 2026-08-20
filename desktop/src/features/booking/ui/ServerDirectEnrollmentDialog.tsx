import * as React from "react";

import { createHttpStaffEnrollmentService } from "@/features/booking/data/staffEnrollmentService";
import type { StaffFamilyDirectoryItem } from "@/features/booking/data/staffFamilyDirectoryService";
import { useStaffFamilyDirectory } from "@/features/booking/data/useStaffFamilyDirectory";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { organizationLocalDateTime } from "@/features/booking/lib/bookingDateTime";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import type {
  BookingWorkspace,
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
import { Input } from "@/shared/ui/input";

type Step = "details" | "review";
export type DirectEnrollmentClient = {
  familyId: string;
  childId: string;
  childName: string;
  parentName: string;
};

function clientChoices(family: StaffFamilyDirectoryItem) {
  return family.children
    .filter((child) => child.status === "active")
    .map(
      (child): DirectEnrollmentClient => ({
        familyId: family.id,
        childId: child.id,
        childName: child.displayName,
        parentName: family.primaryRepresentative.displayName,
      }),
    );
}

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

/** Server-backed direct permanent enrollment for an existing child. */
export function ServerDirectEnrollmentDialog({
  initialClient,
  initialGroupId,
  onOpenChange,
  onSaved,
  open,
  workspace,
}: {
  initialClient?: DirectEnrollmentClient;
  initialGroupId?: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
  workspace: BookingWorkspace;
}) {
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const formatters = createBookingFormatters(workspace.organization.locale);
  const service = React.useMemo(() => createHttpStaffEnrollmentService(), []);
  const [step, setStep] = React.useState<Step>("details");
  const [query, setQuery] = React.useState("");
  const [client, setClient] = React.useState<DirectEnrollmentClient | null>(
    initialClient ?? null,
  );
  const [groupId, setGroupId] = React.useState(initialGroupId ?? "");
  const [tariffId, setTariffId] = React.useState("");
  const [startDate, setStartDate] = React.useState("");
  const [schedule, setSchedule] = React.useState<WeeklyScheduleSelection[]>([]);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const directory = useStaffFamilyDirectory({
    status: "active",
    search: query,
    enabled: open && !initialClient,
  });

  React.useEffect(() => {
    if (!open) return;
    setStep("details");
    setQuery("");
    setClient(initialClient ?? null);
    setGroupId(initialGroupId ?? "");
    setTariffId("");
    setStartDate(
      organizationLocalDateTime(workspace.organization.timeZone, new Date())
        .date,
    );
    setSchedule([]);
    setErrors({});
    setActionError(null);
  }, [initialClient, initialGroupId, open, workspace.organization.timeZone]);

  const groups = React.useMemo(
    () =>
      workspace.groups
        .filter(
          (group) =>
            group.status === "active" &&
            deriveWeeklySlotOptions(workspace, group.id).length > 0,
        )
        .sort((left, right) =>
          left.name.localeCompare(right.name, workspace.organization.locale),
        ),
    [workspace],
  );
  const tariffs = React.useMemo(
    () =>
      workspace.tariffs
        .filter((tariff) => tariff.status === "active")
        .sort((left, right) =>
          left.name.localeCompare(right.name, workspace.organization.locale),
        ),
    [workspace],
  );
  const selectedGroup = groups.find((group) => group.id === groupId);
  const selectedTariff = tariffs.find((tariff) => tariff.id === tariffId);
  const slotOptions = React.useMemo(
    () =>
      groupId
        ? deriveWeeklySlotOptions(workspace, groupId).filter(
            (option) => !startDate || option.endsOn >= startDate,
          )
        : [],
    [groupId, startDate, workspace],
  );
  const choices = directory.items.flatMap(clientChoices);

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

  const review = () => {
    const nextErrors: Record<string, string> = {};
    if (!client) nextErrors.client = messages.requiredField;
    if (!selectedGroup) nextErrors.group = messages.requiredField;
    if (!selectedTariff) nextErrors.tariff = messages.requiredField;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      nextErrors.startDate = messages.requiredField;
    }
    if (!schedule.length) nextErrors.schedule = messages.requiredField;
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
    if (!client || !selectedGroup || !selectedTariff) return;
    setIsSaving(true);
    setActionError(null);
    try {
      await service.enroll({
        familyId: client.familyId,
        childId: client.childId,
        groupId: selectedGroup.id,
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

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:w-full"
        data-testid="airhop-direct-enrollment-dialog"
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
                <Field
                  error={errors.client}
                  label={messages.enrollmentExistingChild}
                >
                  {initialClient ? (
                    <div className="rounded-xl border border-border/70 bg-muted/40 px-4 py-3">
                      <p className="font-medium">{initialClient.childName}</p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {initialClient.parentName}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <Input
                        aria-label={messages.participantSearch}
                        onChange={(event) => {
                          setQuery(event.target.value);
                          setClient(null);
                        }}
                        placeholder={messages.participantSearch}
                        value={query}
                      />
                      <div className="grid max-h-48 gap-2 overflow-y-auto">
                        {choices.map((choice) => (
                          <button
                            className={`rounded-xl border p-3 text-left text-sm ${
                              client?.childId === choice.childId
                                ? "border-primary bg-primary/5"
                                : "border-border/70 hover:bg-accent/40"
                            }`}
                            key={`${choice.familyId}:${choice.childId}`}
                            onClick={() => setClient(choice)}
                            type="button"
                          >
                            <span className="block font-medium">
                              {choice.childName}
                            </span>
                            <span className="text-xs text-muted-foreground">
                              {choice.parentName}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </Field>
                <Field error={errors.group} label={messages.enrollmentGroup}>
                  {initialGroupId ? (
                    <div className="rounded-xl border border-border/70 bg-muted/40 px-4 py-3 font-medium">
                      {selectedGroup?.name ?? initialGroupId}
                    </div>
                  ) : (
                    <BookingSelect
                      onChange={(event) => {
                        setGroupId(event.target.value);
                        setSchedule([]);
                      }}
                      value={groupId}
                    >
                      <option value="">{messages.enrollmentGroup}</option>
                      {groups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </BookingSelect>
                  )}
                </Field>
                <Field error={errors.tariff} label={messages.enrollmentTariff}>
                  <BookingSelect
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
                </Field>
                <Field
                  error={errors.startDate}
                  label={messages.enrollmentStartDate}
                >
                  <AirHopDateInput
                    aria-label={messages.enrollmentStartDate}
                    onChange={setStartDate}
                    value={startDate}
                  />
                </Field>
                <Field
                  error={errors.schedule}
                  label={messages.enrollmentSchedule}
                >
                  <WeeklySchedulePicker
                    locale={workspace.organization.locale}
                    maxSelections={selectedTariff?.weeklyScheduleLimit ?? 1}
                    onChange={setSchedule}
                    options={slotOptions}
                    value={schedule}
                  />
                </Field>
              </>
            ) : (
              <div className="space-y-3 rounded-xl border border-border/70 p-4 text-sm">
                <p className="font-semibold">{client?.childName}</p>
                <p>{selectedGroup?.name}</p>
                <p>{selectedTariff?.name}</p>
                <p>{messages.enrollmentStarts(formatters.date(startDate))}</p>
                <p>
                  {messages.enrollmentSelectedSlots(
                    schedule.length,
                    selectedTariff?.weeklyScheduleLimit ?? 0,
                  )}
                </p>
                <p className="font-medium">
                  {messages.enrollmentFirstPayment}:{" "}
                  {selectedTariff
                    ? formatters.money(
                        selectedTariff.priceMinor,
                        selectedTariff.currency,
                      )
                    : ""}
                </p>
              </div>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-border/70 px-4 py-4 sm:px-6">
            {step === "review" ? (
              <Button
                disabled={isSaving}
                onClick={() => setStep("details")}
                type="button"
                variant="outline"
              >
                {messages.enrollmentBack}
              </Button>
            ) : null}
            <Button disabled={isSaving} type="submit">
              {isSaving
                ? messages.saving
                : step === "details"
                  ? messages.enrollmentContinue
                  : messages.enrollmentConfirm}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
