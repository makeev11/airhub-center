import * as React from "react";

import { createStaffActionContext } from "@/features/booking/actions/airhopActionContext";
import { executeAirhopAction } from "@/features/booking/actions/airhopActionService";
import type { AirhopClientSelector } from "@/features/booking/actions/airhopActionSchemas";
import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { searchFamilySummaries } from "@/features/booking/lib/bookingClients";
import { organizationLocalDateTime } from "@/features/booking/lib/bookingDateTime";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import type {
  BookingChild,
  BookingWorkspace,
  WeeklyScheduleSelection,
} from "@/features/booking/model/bookingCore";
import { normalizePublicBookingPhone } from "@/features/booking/model/publicBooking";
import { BookingSelect } from "@/features/booking/ui/BookingSelect";
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

type ClientMode = "existing" | "new";
type EnrollmentStep = "details" | "review";

type ExistingClient = Extract<AirhopClientSelector, { mode: "existing" }>;

type NewClientForm = {
  parentName: string;
  phone: string;
  childName: string;
  childBirthDate: string;
};

export type EnrollmentSourceVisit = {
  childId: string;
  groupId: string;
};

const EMPTY_NEW_CLIENT: NewClientForm = {
  parentName: "",
  phone: "",
  childName: "",
  childBirthDate: "",
};

function existingClientForChild(
  workspace: BookingWorkspace,
  childId: string,
): ExistingClient | null {
  const child = workspace.children.find(
    (candidate) => candidate.id === childId,
  );
  const family = child
    ? workspace.families.find((candidate) => candidate.id === child.familyId)
    : undefined;
  const representative = family
    ? workspace.representatives.find(
        (candidate) => candidate.id === family.primaryRepresentativeId,
      )
    : undefined;
  if (!child || !family || !representative) return null;
  return {
    mode: "existing",
    familyId: family.id,
    representativeId: representative.id,
    childId: child.id,
  };
}

function childNameForSelector(
  workspace: BookingWorkspace,
  selector: AirhopClientSelector | null,
): string {
  if (!selector) return "";
  if (selector.mode === "new") return selector.applicant.childName;
  return (
    workspace.children.find((child) => child.id === selector.childId)
      ?.displayName ?? selector.childId
  );
}

function existingClientChoices(workspace: BookingWorkspace, query: string) {
  return searchFamilySummaries(workspace, query)
    .filter(({ family }) => family.status === "active")
    .flatMap((summary) =>
      summary.children
        .filter(({ status }) => status === "active")
        .map((child) => ({
          selector: {
            mode: "existing" as const,
            familyId: summary.family.id,
            representativeId: summary.primaryRepresentative.id,
            childId: child.id,
          },
          child,
          parentName: summary.primaryRepresentative.displayName,
          phone: summary.primaryRepresentative.phoneDisplay,
        })),
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

function SelectedChildCard({ child }: { child: BookingChild }) {
  return (
    <div className="rounded-xl border border-border/70 bg-muted/40 px-4 py-3">
      <p className="font-medium">{child.displayName}</p>
    </div>
  );
}

export function EnrollmentDialog({
  initialChildId,
  initialGroupId,
  onOpenChange,
  onSaved,
  open,
  sourceVisit,
}: {
  initialChildId?: string;
  initialGroupId?: string;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
  open: boolean;
  sourceVisit?: EnrollmentSourceVisit;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace;
  const messages = getBookingAdminMessages(
    workspace?.organization.locale ?? "ru-RU",
  );
  const formatters = createBookingFormatters(
    workspace?.organization.locale ?? "ru-RU",
  );
  const resolvedInitialChildId = initialChildId ?? sourceVisit?.childId;
  const resolvedInitialGroupId = initialGroupId ?? sourceVisit?.groupId;
  const [step, setStep] = React.useState<EnrollmentStep>("details");
  const [clientMode, setClientMode] = React.useState<ClientMode>("existing");
  const [query, setQuery] = React.useState("");
  const [client, setClient] = React.useState<AirhopClientSelector | null>(null);
  const [newClient, setNewClient] =
    React.useState<NewClientForm>(EMPTY_NEW_CLIENT);
  const [groupId, setGroupId] = React.useState("");
  const [tariffId, setTariffId] = React.useState("");
  const [weeklySelections, setWeeklySelections] = React.useState<
    WeeklyScheduleSelection[]
  >([]);
  const [startDate, setStartDate] = React.useState("");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [actionError, setActionError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open || !workspace) return;
    setStep("details");
    setClientMode("existing");
    setQuery("");
    setClient(
      resolvedInitialChildId
        ? existingClientForChild(workspace, resolvedInitialChildId)
        : null,
    );
    setNewClient(EMPTY_NEW_CLIENT);
    setGroupId(resolvedInitialGroupId ?? "");
    setTariffId("");
    setWeeklySelections([]);
    setStartDate(
      organizationLocalDateTime(workspace.organization.timeZone, new Date())
        .date,
    );
    setErrors({});
    setActionError(null);
  }, [open, resolvedInitialChildId, resolvedInitialGroupId, workspace]);

  if (!workspace) return null;

  const activeGroups = workspace.groups
    .filter(
      (group) =>
        group.status === "active" &&
        deriveWeeklySlotOptions(workspace, group.id).length > 0,
    )
    .sort((first, second) =>
      first.name.localeCompare(second.name, workspace.organization.locale),
    );
  const activeTariffs = workspace.tariffs
    .filter(({ status }) => status === "active")
    .sort((first, second) =>
      first.name.localeCompare(second.name, workspace.organization.locale),
    );
  const selectedGroup = workspace.groups.find(({ id }) => id === groupId);
  const selectedTariff = workspace.tariffs.find(({ id }) => id === tariffId);
  const selectedChild =
    client?.mode === "existing"
      ? workspace.children.find(({ id }) => id === client.childId)
      : undefined;
  const choices = existingClientChoices(workspace, query);
  const slotOptions = groupId
    ? deriveWeeklySlotOptions(workspace, groupId)
    : [];
  const maximumSelections = selectedTariff?.weeklyScheduleLimit ?? 1;

  const buildClient = (): AirhopClientSelector | null => {
    if (resolvedInitialChildId) {
      return existingClientForChild(workspace, resolvedInitialChildId);
    }
    if (clientMode === "existing") return client;
    const phoneNormalized = normalizePublicBookingPhone(newClient.phone);
    if (
      !newClient.parentName.trim() ||
      !phoneNormalized ||
      !newClient.childName.trim() ||
      !/^\d{4}-\d{2}-\d{2}$/.test(newClient.childBirthDate)
    ) {
      return null;
    }
    return {
      mode: "new",
      applicant: {
        parentName: newClient.parentName.trim(),
        phoneNormalized,
        phoneDisplay: newClient.phone.trim(),
        childName: newClient.childName.trim(),
        childBirthDate: newClient.childBirthDate,
        consentVersion: "staff-enrollment-v1",
        consentAcceptedAt: new Date().toISOString(),
        preferredContactChannel: "phone",
      },
    };
  };

  const review = () => {
    const nextErrors: Record<string, string> = {};
    const nextClient = buildClient();
    if (!nextClient) {
      if (clientMode === "existing" || resolvedInitialChildId) {
        nextErrors.client = messages.requiredField;
      } else {
        if (!newClient.parentName.trim())
          nextErrors.parentName = messages.requiredField;
        if (!normalizePublicBookingPhone(newClient.phone))
          nextErrors.phone = messages.invalidPhone;
        if (!newClient.childName.trim())
          nextErrors.childName = messages.requiredField;
        if (!/^\d{4}-\d{2}-\d{2}$/.test(newClient.childBirthDate)) {
          nextErrors.childBirthDate = messages.invalidBirthDate;
        }
      }
    }
    if (!selectedGroup) nextErrors.group = messages.requiredField;
    if (!selectedTariff) nextErrors.tariff = messages.requiredField;
    if (!weeklySelections.length) nextErrors.schedule = messages.requiredField;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      nextErrors.startDate = messages.requiredField;
    }
    if (
      selectedTariff &&
      weeklySelections.length > selectedTariff.weeklyScheduleLimit
    ) {
      nextErrors.schedule = messages.enrollmentSlotLimitReached(
        selectedTariff.weeklyScheduleLimit,
      );
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || !nextClient) return;
    setClient(nextClient);
    setStep("review");
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (step === "details") {
      review();
      return;
    }
    const finalClient = buildClient();
    if (!finalClient || !selectedGroup || !selectedTariff) {
      setStep("details");
      return;
    }
    setActionError(null);
    try {
      await booking.save((current) => {
        const now = new Date().toISOString();
        return executeAirhopAction(
          current,
          {
            type: "CreateExistingStudent",
            client: finalClient,
            groupId: selectedGroup.id,
            tariffId: selectedTariff.id,
            weeklyScheduleSelections: weeklySelections,
            startDate,
          },
          { userId: "buzz-staff", surface: "staff_ui" },
          createStaffActionContext(now, () => crypto.randomUUID()),
        ).draft;
      });
      onSaved?.();
      onOpenChange(false);
    } catch {
      setActionError(messages.enrollmentActionFailed);
    }
  };

  const newClientField = (
    key: keyof NewClientForm,
    label: string,
    type: React.HTMLInputTypeAttribute = "text",
  ) => (
    <Field error={errors[key]} label={label}>
      <Input
        aria-label={label}
        data-testid={`airhop-enrollment-${key}`}
        onChange={(event) =>
          setNewClient((current) => ({
            ...current,
            [key]: event.target.value,
          }))
        }
        type={type}
        value={newClient[key]}
      />
    </Field>
  );

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
        data-testid="airhop-enrollment-dialog"
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
          <div className="min-h-0 flex-1 space-y-5 overflow-x-hidden overflow-y-auto px-4 py-4 sm:px-6">
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
                  {resolvedInitialChildId && selectedChild ? (
                    <SelectedChildCard child={selectedChild} />
                  ) : (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
                        <Button
                          aria-pressed={clientMode === "existing"}
                          onClick={() => {
                            setClientMode("existing");
                            setClient(null);
                            setErrors({});
                          }}
                          type="button"
                          variant={
                            clientMode === "existing" ? "secondary" : "ghost"
                          }
                        >
                          {messages.participantExistingClient}
                        </Button>
                        <Button
                          aria-pressed={clientMode === "new"}
                          onClick={() => {
                            setClientMode("new");
                            setClient(null);
                            setErrors({});
                          }}
                          type="button"
                          variant={clientMode === "new" ? "secondary" : "ghost"}
                        >
                          {messages.participantNewClient}
                        </Button>
                      </div>
                      {clientMode === "existing" ? (
                        <>
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
                            {choices.length ? (
                              choices.map((choice) => {
                                const selected =
                                  client?.mode === "existing" &&
                                  client.childId === choice.child.id;
                                return (
                                  <Button
                                    aria-pressed={selected}
                                    className="h-auto min-w-0 justify-start whitespace-normal px-3 py-2 text-left"
                                    key={choice.child.id}
                                    onClick={() => setClient(choice.selector)}
                                    type="button"
                                    variant={selected ? "secondary" : "outline"}
                                  >
                                    <span className="min-w-0">
                                      <span className="block font-medium">
                                        {choice.child.displayName}
                                      </span>
                                      <span className="block break-words text-xs text-muted-foreground">
                                        {choice.parentName} · {choice.phone}
                                      </span>
                                    </span>
                                  </Button>
                                );
                              })
                            ) : (
                              <p className="text-sm text-muted-foreground">
                                {messages.participantSearchEmpty}
                              </p>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                          {newClientField(
                            "parentName",
                            messages.representativeName,
                          )}
                          {newClientField(
                            "phone",
                            messages.representativePhone,
                            "tel",
                          )}
                          {newClientField("childName", messages.childName)}
                          {newClientField(
                            "childBirthDate",
                            messages.childBirthDate,
                            "date",
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </Field>

                <Field error={errors.group} label={messages.enrollmentGroup}>
                  {activeGroups.length ? (
                    <BookingSelect
                      aria-label={messages.enrollmentGroup}
                      data-testid="airhop-enrollment-group"
                      disabled={Boolean(resolvedInitialGroupId)}
                      onChange={(event) => {
                        setGroupId(event.target.value);
                        setWeeklySelections([]);
                      }}
                      value={groupId}
                    >
                      <option value="">{messages.enrollmentGroup}</option>
                      {activeGroups.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </BookingSelect>
                  ) : (
                    <Alert>
                      <AlertDescription>
                        {messages.enrollmentNoGroups}
                      </AlertDescription>
                    </Alert>
                  )}
                </Field>

                <Field error={errors.tariff} label={messages.enrollmentTariff}>
                  {activeTariffs.length ? (
                    <BookingSelect
                      aria-label={messages.enrollmentTariff}
                      data-testid="airhop-enrollment-tariff"
                      onChange={(event) => {
                        setTariffId(event.target.value);
                        setWeeklySelections([]);
                      }}
                      value={tariffId}
                    >
                      <option value="">{messages.enrollmentTariff}</option>
                      {activeTariffs.map((tariff) => (
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

                {selectedGroup && selectedTariff ? (
                  <Field
                    error={errors.schedule}
                    label={messages.enrollmentSchedule}
                  >
                    <WeeklySchedulePicker
                      locale={workspace.organization.locale}
                      maxSelections={maximumSelections}
                      onChange={setWeeklySelections}
                      options={slotOptions}
                      value={weeklySelections}
                    />
                  </Field>
                ) : null}

                <Field
                  error={errors.startDate}
                  label={messages.enrollmentStartDate}
                >
                  <Input
                    aria-label={messages.enrollmentStartDate}
                    data-testid="airhop-enrollment-start-date"
                    onChange={(event) => setStartDate(event.target.value)}
                    type="date"
                    value={startDate}
                  />
                </Field>
              </>
            ) : (
              <div className="space-y-4" data-testid="airhop-enrollment-review">
                <dl className="grid gap-4 rounded-xl border border-border/70 p-4 sm:grid-cols-2">
                  <div>
                    <dt className="text-xs text-muted-foreground">
                      {messages.enrollmentExistingChild}
                    </dt>
                    <dd className="mt-1 font-medium">
                      {childNameForSelector(workspace, client)}
                    </dd>
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
                      {weeklySelections.map(slotLabel).join(" · ")}
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
              </div>
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
                  data-testid="airhop-enrollment-review-action"
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
                  data-testid="airhop-enrollment-confirm"
                  disabled={booking.isSaving}
                  type="submit"
                >
                  {booking.isSaving
                    ? messages.saving
                    : messages.enrollmentConfirm}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
