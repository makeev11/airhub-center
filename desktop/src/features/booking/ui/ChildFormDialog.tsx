import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { airHopTodayIsoDate } from "@/features/booking/lib/airHopDateInput";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  childSchema,
  type BookingChild,
} from "@/features/booking/model/bookingCore";
import { upsertBookingChild } from "@/features/booking/model/bookingMutations";
import { BookingFeedbackBanners } from "@/features/booking/ui/BookingWorkspaceState";
import { AirHopDateInput } from "@/features/booking/ui/AirHopDateInput";
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

export function ChildFormDialog({
  child,
  familyId,
  onOpenChange,
  onSaved,
  open,
}: {
  child: BookingChild | null;
  familyId: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace;
  const messages = getBookingAdminMessages(
    workspace?.organization.locale ?? "ru-RU",
  );
  const [form, setForm] = React.useState({
    firstName: "",
    lastName: "",
    birthDate: "",
    note: "",
  });
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setForm({
      firstName: child?.firstName ?? child?.displayName ?? "",
      lastName: child?.lastName ?? "",
      birthDate: child?.birthDate ?? "",
      note: child?.note ?? "",
    });
    setError(null);
  }, [child, open]);
  if (!workspace) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const now = new Date().toISOString();
    const parsed = childSchema.safeParse({
      id: child?.id ?? `child-${crypto.randomUUID()}`,
      organizationId: workspace.organization.id,
      familyId,
      displayName: `${form.firstName.trim()} ${form.lastName.trim()}`,
      firstName: form.firstName,
      lastName: form.lastName,
      birthDate: form.birthDate,
      ...(form.note.trim() ? { note: form.note } : {}),
      status: child?.status ?? "active",
      createdAt: child?.createdAt ?? now,
      updatedAt: now,
    });
    if (!parsed.success) {
      setError(
        !form.firstName.trim() || !form.lastName.trim()
          ? messages.requiredField
          : messages.invalidBirthDate,
      );
      return;
    }
    try {
      await booking.save((current) => upsertBookingChild(current, parsed.data));
      onSaved();
      onOpenChange(false);
    } catch {
      // Keep the form intact so a failed save can be retried.
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-xl" data-testid="airhop-child-form">
        <DialogHeader>
          <DialogTitle>
            {child ? messages.editChildTitle : messages.addChildTitle}
          </DialogTitle>
          <DialogDescription>{messages.familyChildren}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <BookingFeedbackBanners />
          <div className="grid gap-4 sm:grid-cols-2">
            <label
              className="grid gap-1.5 text-sm"
              htmlFor="airhop-child-first-name"
            >
              <span className="font-medium">{messages.childFirstName}</span>
              <Input
                aria-label={messages.childFirstName}
                data-testid="airhop-child-first-name"
                id="airhop-child-first-name"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    firstName: event.target.value,
                  }))
                }
                value={form.firstName}
              />
            </label>
            <label
              className="grid gap-1.5 text-sm"
              htmlFor="airhop-child-last-name"
            >
              <span className="font-medium">{messages.childLastName}</span>
              <Input
                aria-label={messages.childLastName}
                data-testid="airhop-child-last-name"
                id="airhop-child-last-name"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    lastName: event.target.value,
                  }))
                }
                value={form.lastName}
              />
            </label>
          </div>
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="airhop-child-birth-date"
          >
            <span className="font-medium">{messages.childBirthDate}</span>
            <AirHopDateInput
              aria-label={messages.childBirthDate}
              data-testid="airhop-child-birth-date"
              id="airhop-child-birth-date"
              locale={workspace.organization.locale}
              max={airHopTodayIsoDate()}
              onChange={(value) =>
                setForm((current) => ({
                  ...current,
                  birthDate: value,
                }))
              }
              value={form.birthDate}
            />
          </label>
          <label className="grid gap-1.5 text-sm" htmlFor="airhop-child-note">
            <span className="font-medium">{messages.childNote}</span>
            <Input
              aria-label={messages.childNote}
              id="airhop-child-note"
              onChange={(event) =>
                setForm((current) => ({ ...current, note: event.target.value }))
              }
              value={form.note}
            />
          </label>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {messages.cancel}
            </Button>
            <Button disabled={booking.isSaving} type="submit">
              {booking.isSaving ? messages.saving : messages.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
