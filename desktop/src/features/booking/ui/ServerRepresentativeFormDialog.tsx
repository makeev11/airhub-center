import * as React from "react";

import {
  createHttpStaffFamilyCommandService,
  StaffFamilyCommandApiError,
  type StaffRepresentativeContactChannel,
} from "@/features/booking/data/staffFamilyCommandService";
import type { StaffFamilyDetail } from "@/features/booking/data/staffFamilyDetailService";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { getStaffFamilyCommandMessages } from "@/features/booking/lib/staffFamilyCommandLocale";
import { normalizePublicBookingPhone } from "@/features/booking/model/publicBooking";
import { BookingSelect } from "@/features/booking/ui/BookingSelect";
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

type Representative = StaffFamilyDetail["representatives"][number];

/** Adds or edits a server representative through audited staff commands. */
export function ServerRepresentativeFormDialog({
  familyId,
  locale,
  onOpenChange,
  onSaved,
  open,
  representative,
}: {
  familyId: string;
  locale: string;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  open: boolean;
  representative: Representative | null;
}) {
  const messages = getBookingAdminMessages(locale);
  const commandMessages = getStaffFamilyCommandMessages(locale);
  const service = React.useMemo(
    () => createHttpStaffFamilyCommandService(),
    [],
  );
  const [firstName, setFirstName] = React.useState("");
  const [lastName, setLastName] = React.useState("");
  const [phone, setPhone] = React.useState("");
  const [channel, setChannel] =
    React.useState<StaffRepresentativeContactChannel>("phone");
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setFirstName(
      representative?.firstName ?? representative?.displayName ?? "",
    );
    setLastName(representative?.lastName ?? "");
    setPhone(representative?.phoneDisplay ?? "");
    setChannel(representative?.preferredContactChannel ?? "phone");
    setError(null);
  }, [open, representative]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setError(messages.requiredField);
      return;
    }
    if (!normalizePublicBookingPhone(phone)) {
      setError(messages.invalidPhone);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      const displayName = `${firstName.trim()} ${lastName.trim()}`;
      if (representative) {
        await service.updateRepresentative({
          familyId,
          representativeId: representative.id,
          expectedVersion: representative.version,
          displayName,
          firstName,
          lastName,
          phone,
          preferredContactChannel: channel,
        });
      } else {
        await service.addRepresentative({
          familyId,
          displayName,
          firstName,
          lastName,
          phone,
          preferredContactChannel: channel,
        });
      }
      onOpenChange(false);
      void onSaved().catch(() => undefined);
    } catch (cause) {
      setError(
        cause instanceof StaffFamilyCommandApiError && cause.status === 409
          ? commandMessages.saveConflict
          : commandMessages.saveError,
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-w-xl"
        data-testid="airhop-server-representative-form"
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
          <div className="grid gap-4 sm:grid-cols-2">
            <label
              className="grid gap-1.5 text-sm"
              htmlFor="airhop-server-representative-first-name"
            >
              <span className="font-medium">
                {messages.representativeFirstName}
              </span>
              <Input
                data-testid="airhop-server-representative-first-name"
                id="airhop-server-representative-first-name"
                maxLength={80}
                onChange={(event) => setFirstName(event.target.value)}
                value={firstName}
              />
            </label>
            <label
              className="grid gap-1.5 text-sm"
              htmlFor="airhop-server-representative-last-name"
            >
              <span className="font-medium">
                {messages.representativeLastName}
              </span>
              <Input
                data-testid="airhop-server-representative-last-name"
                id="airhop-server-representative-last-name"
                maxLength={80}
                onChange={(event) => setLastName(event.target.value)}
                value={lastName}
              />
            </label>
          </div>
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="airhop-server-representative-phone"
          >
            <span className="font-medium">{messages.representativePhone}</span>
            <Input
              data-testid="airhop-server-representative-phone"
              id="airhop-server-representative-phone"
              maxLength={80}
              onChange={(event) => setPhone(event.target.value)}
              type="tel"
              value={phone}
            />
          </label>
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="airhop-server-representative-channel"
          >
            <span className="font-medium">
              {messages.representativeChannel}
            </span>
            <BookingSelect
              id="airhop-server-representative-channel"
              onChange={(event) =>
                setChannel(
                  event.target.value as StaffRepresentativeContactChannel,
                )
              }
              value={channel}
              wrapperClassName="w-full"
            >
              <option value="telegram">Telegram</option>
              <option value="max">MAX</option>
              <option value="whatsapp">WhatsApp</option>
              <option value="phone">{commandMessages.channelPhone}</option>
              <option value="none">{commandMessages.channelNone}</option>
            </BookingSelect>
          </label>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
          <DialogFooter>
            <Button
              disabled={isSaving}
              onClick={() => onOpenChange(false)}
              type="button"
              variant="outline"
            >
              {messages.cancel}
            </Button>
            <Button disabled={isSaving} type="submit">
              {isSaving ? messages.saving : messages.save}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
