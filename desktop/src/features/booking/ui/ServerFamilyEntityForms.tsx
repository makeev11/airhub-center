import * as React from "react";

import {
  createHttpStaffFamilyCommandService,
  StaffFamilyCommandApiError,
} from "@/features/booking/data/staffFamilyCommandService";
import type { StaffFamilyDetail } from "@/features/booking/data/staffFamilyDetailService";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { getStaffFamilyCommandMessages } from "@/features/booking/lib/staffFamilyCommandLocale";
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
import { Textarea } from "@/shared/ui/textarea";

type Child = StaffFamilyDetail["children"][number];

function commandError(cause: unknown, locale: string): string {
  const messages = getStaffFamilyCommandMessages(locale);
  return cause instanceof StaffFamilyCommandApiError && cause.status === 409
    ? messages.saveConflict
    : messages.saveError;
}

/** Edits the server-owned family label through an audited command. */
export function ServerFamilyFormDialog({
  detail,
  onOpenChange,
  onSaved,
  open,
}: {
  detail: StaffFamilyDetail;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  open: boolean;
}) {
  const messages = getBookingAdminMessages(detail.organization.locale);
  const commandMessages = getStaffFamilyCommandMessages(
    detail.organization.locale,
  );
  const service = React.useMemo(
    () => createHttpStaffFamilyCommandService(),
    [],
  );
  const [name, setName] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setName(detail.family.displayName);
    setError(null);
  }, [detail.family.displayName, open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError(messages.requiredField);
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await service.updateFamily({
        familyId: detail.family.id,
        expectedVersion: detail.family.version,
        displayName: name,
      });
      onOpenChange(false);
      void onSaved().catch(() => undefined);
    } catch (cause) {
      setError(commandError(cause, detail.organization.locale));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-w-xl"
        data-testid="airhop-server-family-form"
      >
        <DialogHeader>
          <DialogTitle>{commandMessages.editFamily}</DialogTitle>
          <DialogDescription>{messages.clientsDescription}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="airhop-server-family-name"
          >
            <span className="font-medium">{messages.family}</span>
            <Input
              id="airhop-server-family-name"
              maxLength={200}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
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

/** Adds or edits one server-owned child through audited sensitive-data commands. */
export function ServerChildFormDialog({
  child,
  detail,
  onOpenChange,
  onSaved,
  open,
}: {
  child: Child | null;
  detail: StaffFamilyDetail;
  onOpenChange: (open: boolean) => void;
  onSaved: () => Promise<void>;
  open: boolean;
}) {
  const messages = getBookingAdminMessages(detail.organization.locale);
  const service = React.useMemo(
    () => createHttpStaffFamilyCommandService(),
    [],
  );
  const [name, setName] = React.useState("");
  const [birthDate, setBirthDate] = React.useState("");
  const [note, setNote] = React.useState("");
  const [isSaving, setIsSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => {
    if (!open) return;
    setName(child?.displayName ?? "");
    setBirthDate(child?.birthDate ?? "");
    setNote(child?.note ?? "");
    setError(null);
  }, [child, open]);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (
      !name.trim() ||
      !birthDate ||
      birthDate > detail.organization.currentDate
    ) {
      setError(
        !name.trim() ? messages.requiredField : messages.invalidBirthDate,
      );
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      if (child) {
        await service.updateChild({
          familyId: detail.family.id,
          childId: child.id,
          expectedVersion: child.version,
          displayName: name,
          birthDate,
          note,
        });
      } else {
        await service.addChild({
          familyId: detail.family.id,
          displayName: name,
          birthDate,
          note,
        });
      }
      onOpenChange(false);
      void onSaved().catch(() => undefined);
    } catch (cause) {
      setError(commandError(cause, detail.organization.locale));
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent
        className="max-w-xl"
        data-testid="airhop-server-child-form"
      >
        <DialogHeader>
          <DialogTitle>
            {child ? messages.editChildTitle : messages.addChildTitle}
          </DialogTitle>
          <DialogDescription>{messages.familyChildren}</DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="airhop-server-child-name"
          >
            <span className="font-medium">{messages.childName}</span>
            <Input
              id="airhop-server-child-name"
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
          </label>
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="airhop-server-child-birth-date"
          >
            <span className="font-medium">{messages.childBirthDate}</span>
            <AirHopDateInput
              aria-label={messages.childBirthDate}
              id="airhop-server-child-birth-date"
              max={detail.organization.currentDate}
              onChange={setBirthDate}
              value={birthDate}
            />
          </label>
          <label
            className="grid gap-1.5 text-sm"
            htmlFor="airhop-server-child-note"
          >
            <span className="font-medium">{messages.childNote}</span>
            <Textarea
              id="airhop-server-child-note"
              maxLength={4_000}
              onChange={(event) => setNote(event.target.value)}
              value={note}
            />
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
