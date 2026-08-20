import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import type { StaffFamilyDirectoryItem } from "@/features/booking/data/staffFamilyDirectoryService";
import type {
  StaffLessonParticipantClient,
  StaffLessonService,
} from "@/features/booking/data/staffLessonService";
import { useStaffFamilyDirectory } from "@/features/booking/data/useStaffFamilyDirectory";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { airHopTodayIsoDate } from "@/features/booking/lib/airHopDateInput";
import type { ScheduleLesson } from "@/features/booking/model/demoSchedule";
import { normalizePublicBookingPhone } from "@/features/booking/model/publicBooking";
import { AirHopDateInput } from "@/features/booking/ui/AirHopDateInput";
import { BookingSelect } from "@/features/booking/ui/BookingSelect";
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
type SelectedClient = Extract<
  StaffLessonParticipantClient,
  { mode: "existing" }
>;

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

function clientChoices(summary: StaffFamilyDirectoryItem) {
  return summary.children
    .filter((child) => child.status === "active")
    .map((child) => ({
      mode: "existing" as const,
      familyId: summary.id,
      representativeId: summary.primaryRepresentative.id,
      childId: child.id,
      childName: child.displayName,
      parentName: summary.primaryRepresentative.displayName,
      phone: summary.primaryRepresentative.phoneDisplay,
    }));
}

export function ServerLessonParticipantDialog({
  lesson,
  onOpenChange,
  onSaved,
  open,
  service,
}: {
  lesson: ScheduleLesson | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
  service: StaffLessonService;
}) {
  const booking = useBookingWorkspace();
  const messages = getBookingAdminMessages(
    booking.workspace?.organization.locale ?? "ru-RU",
  );
  const [mode, setMode] = React.useState<ClientMode>("existing");
  const [query, setQuery] = React.useState("");
  const [selectedClient, setSelectedClient] =
    React.useState<SelectedClient | null>(null);
  const [form, setForm] = React.useState(EMPTY_FORM);
  const [visitKind, setVisitKind] = React.useState<VisitKind>("trial");
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [actionError, setActionError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);
  const directory = useStaffFamilyDirectory({
    status: "active",
    search: query,
    enabled: open && lesson !== null && mode === "existing",
  });
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

  if (!lesson) return null;
  const choices = directory.items.flatMap(clientChoices);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setActionError(null);
    const nextErrors: Record<string, string> = {};
    let client: StaffLessonParticipantClient | null = null;
    if (mode === "existing") {
      if (!selectedClient) nextErrors.client = messages.requiredField;
      else client = selectedClient;
    } else {
      const phoneNormalized = normalizePublicBookingPhone(form.phone);
      if (!form.parentName.trim())
        nextErrors.parentName = messages.requiredField;
      if (!phoneNormalized) nextErrors.phone = messages.invalidPhone;
      if (!form.childName.trim()) nextErrors.childName = messages.requiredField;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(form.childBirthDate))
        nextErrors.childBirthDate = messages.invalidBirthDate;
      if (phoneNormalized) {
        client = {
          mode: "new",
          parentName: form.parentName.trim(),
          phone: form.phone.trim(),
          childName: form.childName.trim(),
          childBirthDate: form.childBirthDate,
        };
      }
    }
    if (!visitKinds.includes(visitKind)) {
      nextErrors.visitKind = messages.requiredField;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || !client) return;

    setIsSaving(true);
    try {
      await service.addParticipant({
        lessonRef: {
          recurrenceRuleId: lesson.recurrenceRuleId,
          originalDate: lesson.originalDate,
        },
        client,
        visitKind,
      });
      onSaved();
      onOpenChange(false);
    } catch {
      setActionError(messages.participantActionFailed);
    } finally {
      setIsSaving(false);
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
          data-testid={`airhop-participant-${key.replace("childBirthDate", "birth-date")}`}
          id={`airhop-participant-${key}`}
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
          data-testid={`airhop-participant-${key.replace("parentName", "parent-name").replace("childName", "child-name")}`}
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
                  {directory.status === "loading" ? (
                    <p className="text-sm text-muted-foreground">
                      {messages.loadingDescription}
                    </p>
                  ) : choices.length ? (
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
                      {directory.status === "error"
                        ? messages.loadErrorDescription
                        : messages.participantSearchEmpty}
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
              disabled={isSaving || visitKinds.length === 0}
              type="submit"
            >
              {isSaving ? messages.saving : messages.participantAdd}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
