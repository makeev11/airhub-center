import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import type { BookingRepresentative } from "@/features/booking/model/bookingCore";
import { representativeSchema } from "@/features/booking/model/bookingCore";
import {
  upsertBookingFamily,
  upsertBookingRepresentative,
} from "@/features/booking/model/bookingMutations";
import { normalizePublicBookingPhone } from "@/features/booking/model/publicBooking";
import { BookingFeedbackBanners } from "@/features/booking/ui/BookingWorkspaceState";
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

export function RepresentativeFormDialog({
  familyId,
  onOpenChange,
  onSaved,
  open,
  representative,
}: {
  familyId: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
  open: boolean;
  representative: BookingRepresentative | null;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace;
  const messages = getBookingAdminMessages(
    workspace?.organization.locale ?? "ru-RU",
  );
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [makePrimary, setMakePrimary] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const family = workspace?.families.find(
    (candidate) => candidate.id === familyId,
  );
  const isCurrentPrimary =
    representative !== null &&
    representative.id === family?.primaryRepresentativeId;
  React.useEffect(() => {
    if (!open) return;
    setFirstName(
      representative?.firstName ?? representative?.displayName ?? "",
    );
    setLastName(representative?.lastName ?? "");
    setPhone(representative?.phoneDisplay ?? "");
    setMakePrimary(isCurrentPrimary);
    setError(null);
  }, [isCurrentPrimary, open, representative]);
  if (!workspace) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const phoneNormalized = normalizePublicBookingPhone(phone);
    if (!firstName.trim() || !lastName.trim() || !phoneNormalized) {
      setError(
        !firstName.trim() || !lastName.trim()
          ? messages.requiredField
          : messages.invalidPhone,
      );
      return;
    }
    const now = new Date().toISOString();
    const parsed = representativeSchema.parse({
      id: representative?.id ?? `representative-${crypto.randomUUID()}`,
      organizationId: workspace.organization.id,
      familyId,
      displayName: `${firstName.trim()} ${lastName.trim()}`,
      firstName,
      lastName,
      phoneNormalized,
      phoneDisplay: phone.trim(),
      preferredContactChannel:
        representative?.preferredContactChannel ?? "phone",
      messengerAccounts: representative?.messengerAccounts ?? [],
      consentVersion: representative?.consentVersion ?? "staff-entry-v1",
      consentAcceptedAt: representative?.consentAcceptedAt ?? now,
      status: representative?.status ?? "active",
      createdAt: representative?.createdAt ?? now,
      updatedAt: now,
    });
    try {
      await booking.save((current) => {
        const withRepresentative = upsertBookingRepresentative(current, parsed);
        if (!makePrimary) return withRepresentative;
        const currentFamily = current.families.find(
          (candidate) => candidate.id === familyId,
        );
        if (!currentFamily) return withRepresentative;
        return upsertBookingFamily(
          { ...current, ...withRepresentative },
          {
            ...currentFamily,
            primaryRepresentativeId: parsed.id,
            updatedAt: now,
          },
        );
      });
      onSaved();
      onOpenChange(false);
    } catch {
      // Keep the form intact so a failed save can be retried.
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-w-xl"
        data-testid="airhop-representative-form"
      >
        <DialogHeader>
          <DialogTitle>
            {representative
              ? messages.editRepresentativeTitle
              : messages.addRepresentativeTitle}
          </DialogTitle>
          <DialogDescription>
            {messages.familyRepresentatives}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <BookingFeedbackBanners />
          <div className="grid gap-4 sm:grid-cols-2">
            <label
              className="grid gap-1.5 text-sm"
              htmlFor="airhop-representative-first-name"
            >
              <span className="font-medium">
                {messages.representativeFirstName}
              </span>
              <Input
                aria-label={messages.representativeFirstName}
                data-testid="airhop-representative-first-name"
                id="airhop-representative-first-name"
                onChange={(event) => setFirstName(event.target.value)}
                value={firstName}
              />
            </label>
            <label
              className="grid gap-1.5 text-sm"
              htmlFor="airhop-representative-last-name"
            >
              <span className="font-medium">
                {messages.representativeLastName}
              </span>
              <Input
                aria-label={messages.representativeLastName}
                data-testid="airhop-representative-last-name"
                id="airhop-representative-last-name"
                onChange={(event) => setLastName(event.target.value)}
                value={lastName}
              />
            </label>
          </div>
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="airhop-representative-phone"
          >
            <span className="font-medium">{messages.representativePhone}</span>
            <Input
              aria-label={messages.representativePhone}
              data-testid="airhop-representative-phone"
              id="airhop-representative-phone"
              onChange={(event) => setPhone(event.target.value)}
              type="tel"
              value={phone}
            />
          </label>
          {family &&
          workspace.representatives.filter(
            (candidate) => candidate.familyId === familyId,
          ).length > 1 ? (
            <label
              className="flex items-center gap-2 text-sm"
              htmlFor="airhop-representative-primary"
            >
              <Checkbox
                checked={makePrimary}
                data-testid="airhop-representative-primary"
                disabled={isCurrentPrimary}
                id="airhop-representative-primary"
                onCheckedChange={(checked) => setMakePrimary(checked === true)}
              />
              <span className="font-medium">
                {messages.familyPrimaryContact}
              </span>
            </label>
          ) : null}
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
