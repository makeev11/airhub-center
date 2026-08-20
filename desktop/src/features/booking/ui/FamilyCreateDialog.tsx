import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { airHopTodayIsoDate } from "@/features/booking/lib/airHopDateInput";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { normalizePublicBookingPhone } from "@/features/booking/model/publicBooking";
import {
  childSchema,
  familySchema,
  representativeSchema,
} from "@/features/booking/model/bookingCore";
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

export function FamilyCreateDialog({
  onCreated,
  onOpenChange,
  open,
}: {
  onCreated: (familyId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace;
  const messages = getBookingAdminMessages(
    workspace?.organization.locale ?? "ru-RU",
  );
  const [form, setForm] = React.useState({
    familyName: "",
    representativeFirstName: "",
    representativeLastName: "",
    phone: "",
    childFirstName: "",
    childLastName: "",
    childBirthDate: "",
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    setForm({
      familyName: "",
      representativeFirstName: "",
      representativeLastName: "",
      phone: "",
      childFirstName: "",
      childLastName: "",
      childBirthDate: "",
    });
    setErrors({});
  }, [open]);
  if (!workspace) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const phoneNormalized = normalizePublicBookingPhone(form.phone);
    const nextErrors: Record<string, string> = {};
    if (!form.familyName.trim()) nextErrors.familyName = messages.requiredField;
    if (!form.representativeFirstName.trim())
      nextErrors.representativeFirstName = messages.requiredField;
    if (!form.representativeLastName.trim())
      nextErrors.representativeLastName = messages.requiredField;
    if (!phoneNormalized) nextErrors.phone = messages.invalidPhone;
    if (!form.childFirstName.trim())
      nextErrors.childFirstName = messages.requiredField;
    if (!form.childLastName.trim())
      nextErrors.childLastName = messages.requiredField;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.childBirthDate))
      nextErrors.childBirthDate = messages.invalidBirthDate;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || !phoneNormalized) return;

    const suffix = crypto.randomUUID();
    const familyId = `family-${suffix}`;
    const representativeId = `representative-${suffix}`;
    const childId = `child-${suffix}`;
    const now = new Date().toISOString();
    const representativeDisplayName = [
      form.representativeFirstName.trim(),
      form.representativeLastName.trim(),
    ].join(" ");
    const childDisplayName = [
      form.childFirstName.trim(),
      form.childLastName.trim(),
    ].join(" ");
    const family = familySchema.parse({
      id: familyId,
      organizationId: workspace.organization.id,
      displayName: form.familyName.trim(),
      primaryRepresentativeId: representativeId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const representative = representativeSchema.parse({
      id: representativeId,
      organizationId: workspace.organization.id,
      familyId,
      displayName: representativeDisplayName,
      firstName: form.representativeFirstName,
      lastName: form.representativeLastName,
      phoneNormalized,
      phoneDisplay: form.phone.trim(),
      preferredContactChannel: "phone",
      messengerAccounts: [],
      consentVersion: "staff-entry-v1",
      consentAcceptedAt: now,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const parsedChild = childSchema.safeParse({
      id: childId,
      organizationId: workspace.organization.id,
      familyId,
      displayName: childDisplayName,
      firstName: form.childFirstName,
      lastName: form.childLastName,
      birthDate: form.childBirthDate,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    if (!parsedChild.success) {
      setErrors((current) => ({
        ...current,
        childBirthDate: messages.invalidBirthDate,
      }));
      return;
    }
    try {
      await booking.save((current) => {
        const { revision: _revision, ...draft } = current;
        return {
          ...draft,
          families: [...current.families, family],
          representatives: [...current.representatives, representative],
          children: [...current.children, parsedChild.data],
        };
      });
      onCreated(familyId);
      onOpenChange(false);
    } catch {
      // Keep the form intact so a failed save can be retried.
    }
  };

  const field = (
    key: keyof typeof form,
    label: string,
    type: React.HTMLInputTypeAttribute = "text",
  ) => (
    <label className="grid gap-1.5 text-sm" htmlFor={`airhop-family-${key}`}>
      <span className="font-medium">{label}</span>
      {type === "date" ? (
        <AirHopDateInput
          aria-label={label}
          data-testid={`airhop-family-${key}`}
          id={`airhop-family-${key}`}
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
          data-testid={`airhop-family-${key}`}
          id={`airhop-family-${key}`}
          onChange={(event) =>
            setForm((current) => ({ ...current, [key]: event.target.value }))
          }
          type={type}
          value={form[key]}
        />
      )}
      {errors[key] ? (
        <span className="text-xs text-destructive">{errors[key]}</span>
      ) : null}
    </label>
  );

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      <DialogContent className="max-w-xl" data-testid="airhop-family-form">
        <DialogHeader>
          <DialogTitle>{messages.createFamilyTitle}</DialogTitle>
          <DialogDescription>
            {messages.createFamilyDescription}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          <BookingFeedbackBanners />
          {field("familyName", messages.familyName)}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("representativeFirstName", messages.representativeFirstName)}
            {field("representativeLastName", messages.representativeLastName)}
          </div>
          {field("phone", messages.representativePhone, "tel")}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("childFirstName", messages.childFirstName)}
            {field("childLastName", messages.childLastName)}
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            {field("childBirthDate", messages.childBirthDate, "date")}
          </div>
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
