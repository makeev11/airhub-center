import * as React from "react";

import { createStaffActionContext } from "@/features/booking/actions/airhopActionContext";
import {
  AirhopActionError,
  executeAirhopAction,
} from "@/features/booking/actions/airhopActionService";
import type { AirhopClientSelector } from "@/features/booking/actions/airhopActionSchemas";
import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { airHopTodayIsoDate } from "@/features/booking/lib/airHopDateInput";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  searchFamilySummaries,
  type FamilySummary,
} from "@/features/booking/lib/bookingClients";
import type { ScheduleLesson } from "@/features/booking/model/demoSchedule";
import { normalizePublicBookingPhone } from "@/features/booking/model/publicBooking";
import { BookingSelect } from "@/features/booking/ui/BookingSelect";
import { AirHopDateInput } from "@/features/booking/ui/AirHopDateInput";
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
type VisitKind = "trial" | "single";

type SelectedClient = {
  familyId: string;
  representativeId: string;
  childId: string;
};

const EMPTY_FORM = {
  parentName: "",
  phone: "",
  childName: "",
  childBirthDate: "",
};

function availableVisitKinds(lesson: ScheduleLesson): VisitKind[] {
  const kinds: VisitKind[] = [];
  if (lesson.trial.mode !== "disabled") kinds.push("trial");
  if (lesson.singleVisitAllowed) kinds.push("single");
  return kinds;
}

function clientChoices(summary: FamilySummary) {
  return summary.children
    .filter((child) => child.status === "active")
    .map((child) => ({
      familyId: summary.family.id,
      representativeId: summary.primaryRepresentative.id,
      childId: child.id,
      childName: child.displayName,
      parentName: summary.primaryRepresentative.displayName,
      phone: summary.primaryRepresentative.phoneDisplay,
    }));
}

export function LessonParticipantDialog({
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
  const messages = getBookingAdminMessages(
    workspace?.organization.locale ?? "ru-RU",
  );
  const [mode, setMode] = React.useState<ClientMode>("existing");
  const [query, setQuery] = React.useState("");
  const [selectedClient, setSelectedClient] =
    React.useState<SelectedClient | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [visitKind, setVisitKind] = React.useState<VisitKind>("trial");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [actionError, setActionError] = React.useState<string | null>(null);

  const visitKinds = lesson ? availableVisitKinds(lesson) : [];
  React.useEffect(() => {
    if (!open || !lesson) return;
    const kinds = availableVisitKinds(lesson);
    setMode("existing");
    setQuery("");
    setSelectedClient(null);
    setForm(EMPTY_FORM);
    setVisitKind(kinds[0] ?? "trial");
    setErrors({});
    setActionError(null);
  }, [lesson, open]);

  if (!workspace || !lesson) return null;
  const summaries = searchFamilySummaries(workspace, query).filter(
    (summary) => summary.family.status === "active",
  );
  const choices = summaries.flatMap(clientChoices);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setActionError(null);
    const nextErrors: Record<string, string> = {};
    let client: AirhopClientSelector | null = null;

    if (mode === "existing") {
      if (!selectedClient) nextErrors.client = messages.requiredField;
      else client = { mode: "existing", ...selectedClient };
    } else {
      const phoneNormalized = normalizePublicBookingPhone(form.phone);
      if (!form.parentName.trim())
        nextErrors.parentName = messages.requiredField;
      if (!phoneNormalized) nextErrors.phone = messages.invalidPhone;
      if (!form.childName.trim()) nextErrors.childName = messages.requiredField;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.childBirthDate))
        nextErrors.childBirthDate = messages.invalidBirthDate;
      if (phoneNormalized) {
        const now = new Date().toISOString();
        client = {
          mode: "new",
          applicant: {
            parentName: form.parentName.trim(),
            phoneNormalized,
            phoneDisplay: form.phone.trim(),
            childName: form.childName.trim(),
            childBirthDate: form.childBirthDate,
            consentVersion: "staff-entry-v1",
            consentAcceptedAt: now,
            preferredContactChannel: "phone",
          },
        };
      }
    }
    if (!visitKinds.includes(visitKind)) {
      nextErrors.visitKind = messages.requiredField;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !client) return;

    try {
      await booking.save((current) => {
        const now = new Date().toISOString();
        const context = createStaffActionContext(now, () =>
          crypto.randomUUID(),
        );
        return executeAirhopAction(
          current,
          {
            type: "AddLessonParticipant",
            submissionMode: "direct",
            client,
            lessonRef: {
              recurrenceRuleId: lesson.recurrenceRuleId,
              originalDate: lesson.originalDate,
            },
            visitKind,
            sourceChannel: "phone",
          },
          { userId: "buzz-staff", surface: "staff_ui" },
          context,
        ).draft;
      });
      onSaved();
      onOpenChange(false);
    } catch (error) {
      setActionError(
        error instanceof AirhopActionError
          ? messages.participantActionFailed
          : messages.saveErrorDescription,
      );
    }
  };

  const field = (
    key: keyof typeof form,
    label: string,
    type: React.HTMLInputTypeAttribute = "text",
  ) => (
    <label
      className="grid min-w-0 gap-1.5 text-sm"
      htmlFor={`airhop-participant-${key}`}
    >
      <span className="font-medium">{label}</span>
      {type === "date" ? (
        <AirHopDateInput
          aria-label={label}
          aria-describedby={
            errors[key] ? `airhop-participant-${key}-error` : undefined
          }
          aria-invalid={Boolean(errors[key])}
          data-testid={`airhop-participant-${key.replace("childBirthDate", "birth-date").replace("parentName", "parent-name").replace("childName", "child-name")}`}
          id={`airhop-participant-${key}`}
          locale={workspace.organization.locale}
          max={airHopTodayIsoDate()}
          onChange={(value) =>
            setForm((current) => ({ ...current, [key]: value }))
          }
          value={form[key]}
        />
      ) : (
        <Input
          aria-label={label}
          aria-describedby={
            errors[key] ? `airhop-participant-${key}-error` : undefined
          }
          aria-invalid={Boolean(errors[key])}
          data-testid={`airhop-participant-${key.replace("childBirthDate", "birth-date").replace("parentName", "parent-name").replace("childName", "child-name")}`}
          id={`airhop-participant-${key}`}
          onChange={(event) =>
            setForm((current) => ({ ...current, [key]: event.target.value }))
          }
          type={type}
          value={form[key]}
        />
      )}
      {errors[key] ? (
        <span
          className="text-xs text-destructive"
          id={`airhop-participant-${key}-error`}
        >
          {errors[key]}
        </span>
      ) : null}
    </label>
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] max-w-2xl flex-col gap-0 overflow-hidden p-0 sm:w-full"
        data-testid="airhop-lesson-participant-dialog"
      >
        <DialogHeader className="shrink-0 border-b border-border/70 px-4 py-4 pr-12 text-left sm:px-6">
          <DialogTitle>{messages.lessonAddParticipantTitle}</DialogTitle>
          <DialogDescription>
            {lesson.groupName} · {lesson.date}, {lesson.startTime}–
            {lesson.endTime}
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
            <div className="grid grid-cols-2 gap-2 rounded-lg bg-muted p-1">
              <Button
                aria-pressed={mode === "existing"}
                data-testid="airhop-participant-existing-mode"
                onClick={() => {
                  setMode("existing");
                  setErrors({});
                }}
                type="button"
                variant={mode === "existing" ? "secondary" : "ghost"}
              >
                {messages.participantExistingClient}
              </Button>
              <Button
                aria-pressed={mode === "new"}
                data-testid="airhop-participant-new-mode"
                onClick={() => {
                  setMode("new");
                  setErrors({});
                }}
                type="button"
                variant={mode === "new" ? "secondary" : "ghost"}
              >
                {messages.participantNewClient}
              </Button>
            </div>

            {mode === "existing" ? (
              <div className="space-y-3">
                <Input
                  aria-label={messages.participantSearch}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setSelectedClient(null);
                  }}
                  placeholder={messages.participantSearch}
                  value={query}
                />
                <div className="grid max-h-56 gap-2 overflow-y-auto">
                  {choices.length ? (
                    choices.map((choice) => {
                      const selected =
                        selectedClient?.childId === choice.childId;
                      return (
                        <Button
                          aria-pressed={selected}
                          className="h-auto min-w-0 justify-start whitespace-normal px-3 py-2 text-left"
                          key={choice.childId}
                          onClick={() => setSelectedClient(choice)}
                          type="button"
                          variant={selected ? "secondary" : "outline"}
                        >
                          <span className="min-w-0">
                            <span className="block font-medium">
                              {choice.childName}
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
                {errors.client ? (
                  <p className="text-xs text-destructive">{errors.client}</p>
                ) : null}
              </div>
            ) : (
              <div className="grid min-w-0 gap-4 sm:grid-cols-2">
                {field("parentName", messages.representativeName)}
                {field("phone", messages.representativePhone, "tel")}
                {field("childName", messages.childName)}
                {field("childBirthDate", messages.childBirthDate, "date")}
              </div>
            )}

            {visitKinds.length > 1 ? (
              <label
                className="grid gap-1.5 text-sm"
                htmlFor="airhop-participant-visit-kind"
              >
                <span className="font-medium">
                  {messages.participantVisitKind}
                </span>
                <BookingSelect
                  data-testid="airhop-participant-visit-kind"
                  id="airhop-participant-visit-kind"
                  onChange={(event) =>
                    setVisitKind(event.target.value as VisitKind)
                  }
                  value={visitKind}
                >
                  {visitKinds.includes("trial") ? (
                    <option value="trial">
                      {messages.participantVisitTrial}
                    </option>
                  ) : null}
                  {visitKinds.includes("single") ? (
                    <option value="single">
                      {messages.participantVisitSingle}
                    </option>
                  ) : null}
                </BookingSelect>
              </label>
            ) : visitKinds.length === 1 ? (
              <div className="grid gap-1.5 text-sm">
                <span className="font-medium">
                  {messages.participantVisitKind}
                </span>
                <div
                  className="flex min-h-10 items-center rounded-lg border border-border bg-muted/35 px-3 text-foreground"
                  data-testid="airhop-participant-visit-kind-label"
                >
                  {visitKinds[0] === "trial"
                    ? messages.participantVisitTrial
                    : messages.participantVisitSingle}
                </div>
              </div>
            ) : (
              <Alert>
                <AlertDescription>
                  {messages.participantNoVisitKinds}
                </AlertDescription>
              </Alert>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t border-border/70 px-4 py-3 sm:px-6">
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {messages.cancel}
            </Button>
            <Button
              disabled={booking.isSaving || visitKinds.length === 0}
              type="submit"
            >
              {booking.isSaving ? messages.saving : messages.participantAdd}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
