import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  teacherSchema,
  type BookingTeacher,
} from "@/features/booking/model/bookingCore";
import { upsertBookingTeacher } from "@/features/booking/model/bookingMutations";
import { BookingFeedbackBanners } from "@/features/booking/ui/BookingWorkspaceState";
import { useBookingUnsavedChangesGuard } from "@/features/booking/ui/useBookingUnsavedChangesGuard";
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

type TeacherForm = {
  id: string;
  displayName: string;
  buzzUsername: string;
};

function createTeacherId(): string {
  return `teacher-${crypto.randomUUID()}`;
}

function formFromTeacher(teacher: BookingTeacher | null): TeacherForm {
  return teacher
    ? {
        id: teacher.id,
        displayName: teacher.displayName,
        buzzUsername: teacher.buzzUsername ?? "",
      }
    : { id: createTeacherId(), displayName: "", buzzUsername: "" };
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

export function TeacherFormDialog({
  onOpenChange,
  onSaved,
  open,
  teacher,
}: {
  onOpenChange: (open: boolean) => void;
  onSaved: (kind: "created" | "updated") => void;
  open: boolean;
  teacher: BookingTeacher | null;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace;
  const messages = getBookingAdminMessages(
    workspace?.organization.locale ?? "ru-RU",
  );
  const freshTeacher = teacher
    ? (workspace?.teachers.find((candidate) => candidate.id === teacher.id) ??
      null)
    : null;
  const [form, setForm] = React.useState<TeacherForm>(() =>
    formFromTeacher(teacher),
  );
  const [baseline, setBaseline] = React.useState<TeacherForm | null>(null);
  const [nameError, setNameError] = React.useState<string | undefined>();

  React.useEffect(() => {
    if (!open) return;
    const fresh = formFromTeacher(freshTeacher);
    setForm(fresh);
    setBaseline(fresh);
    setNameError(undefined);
  }, [freshTeacher, open]);

  const dirty =
    open &&
    baseline !== null &&
    JSON.stringify(form) !== JSON.stringify(baseline);
  useBookingUnsavedChangesGuard(dirty, messages.unsavedChangesConfirm);
  if (!workspace) return null;

  const requestOpenChange = (nextOpen: boolean) => {
    if (nextOpen || !dirty || window.confirm(messages.unsavedChangesConfirm)) {
      onOpenChange(nextOpen);
    }
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const buzzUsername = form.buzzUsername.trim().replace(/^@/, "");
    const parsed = teacherSchema.safeParse({
      id: form.id,
      organizationId: workspace.organization.id,
      displayName: form.displayName,
      ...(buzzUsername ? { buzzUsername } : {}),
      status: freshTeacher?.status ?? "active",
    });
    if (!form.displayName.trim() || !parsed.success) {
      setNameError(messages.requiredField);
      return;
    }
    setNameError(undefined);
    try {
      await booking.save((current) =>
        upsertBookingTeacher(current, parsed.data),
      );
      onSaved(teacher ? "updated" : "created");
      onOpenChange(false);
    } catch {
      // Shared feedback keeps the current form open after save failures.
    }
  };

  return (
    <Dialog onOpenChange={requestOpenChange} open={open}>
      <DialogContent className="max-w-xl" data-testid="airhop-teacher-form">
        <DialogHeader>
          <DialogTitle>
            {teacher ? messages.editTeacherTitle : messages.createTeacherTitle}
          </DialogTitle>
          <DialogDescription>
            {teacher
              ? messages.editTeacherDescription
              : messages.createTeacherDescription}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(event) => void submit(event)}>
          <BookingFeedbackBanners />
          <Field error={nameError} label={messages.teacherName}>
            <Input
              aria-label={messages.teacherName}
              data-testid="airhop-teacher-name"
              maxLength={160}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  displayName: event.target.value,
                }))
              }
              value={form.displayName}
            />
          </Field>
          <Field
            hint={messages.teacherBuzzUsernameHint}
            label={messages.teacherBuzzUsername}
          >
            <Input
              aria-label={messages.teacherBuzzUsername}
              data-testid="airhop-teacher-buzz-username"
              maxLength={160}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  buzzUsername: event.target.value,
                }))
              }
              value={form.buzzUsername}
            />
          </Field>
          <DialogFooter>
            <Button
              onClick={() => requestOpenChange(false)}
              type="button"
              variant="outline"
            >
              {messages.cancel}
            </Button>
            <Button disabled={booking.isSaving || !dirty} type="submit">
              {booking.isSaving ? messages.saving : messages.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
