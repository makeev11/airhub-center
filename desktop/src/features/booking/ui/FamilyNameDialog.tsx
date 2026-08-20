import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import type { BookingFamily } from "@/features/booking/model/bookingCore";
import { familySchema } from "@/features/booking/model/bookingCore";
import { upsertBookingFamily } from "@/features/booking/model/bookingMutations";
import { BookingFeedbackBanners } from "@/features/booking/ui/BookingWorkspaceState";
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

export function FamilyNameDialog({
  family,
  onOpenChange,
  open,
}: {
  family: BookingFamily;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const booking = useBookingWorkspace();
  const messages = getBookingAdminMessages(
    booking.workspace?.organization.locale ?? "ru-RU",
  );
  const [name, setName] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setName(family.displayName);
    setError(null);
  }, [family.displayName, open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const displayName = name.trim();
    if (!displayName) {
      setError(messages.requiredField);
      return;
    }

    const updated = familySchema.parse({
      ...family,
      displayName,
      updatedAt: new Date().toISOString(),
    });
    try {
      await booking.save((current) => upsertBookingFamily(current, updated));
      onOpenChange(false);
    } catch {
      // Shared feedback keeps the error visible without discarding the form.
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-md" data-testid="airhop-family-name-form">
        <DialogHeader>
          <DialogTitle>{messages.editFamilyNameTitle}</DialogTitle>
          <DialogDescription>
            {messages.editFamilyNameDescription}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <BookingFeedbackBanners />
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="airhop-family-display-name"
          >
            <span className="font-medium">{messages.familyName}</span>
            <Input
              aria-label={messages.familyName}
              autoFocus
              data-testid="airhop-family-display-name"
              id="airhop-family-display-name"
              onChange={(event) => {
                setName(event.target.value);
                setError(null);
              }}
              value={name}
            />
            {error ? (
              <span className="text-xs text-destructive">{error}</span>
            ) : null}
          </label>
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
