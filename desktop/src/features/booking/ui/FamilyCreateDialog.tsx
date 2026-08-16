import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { normalizePublicBookingPhone } from "@/features/booking/model/publicBooking";
import {
  childSchema,
  familySchema,
  representativeSchema,
} from "@/features/booking/model/bookingCore";
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
    representativeName: "",
    phone: "",
    childName: "",
    childBirthDate: "",
  });
  const [errors, setErrors] = React.useState<Record<string, string>>({});

  React.useEffect(() => {
    if (!open) return;
    setForm({
      representativeName: "",
      phone: "",
      childName: "",
      childBirthDate: "",
    });
    setErrors({});
  }, [open]);
  if (!workspace) return null;

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const phoneNormalized = normalizePublicBookingPhone(form.phone);
    const nextErrors: Record<string, string> = {};
    if (!form.representativeName.trim())
      nextErrors.representativeName = messages.requiredField;
    if (!phoneNormalized) nextErrors.phone = messages.invalidPhone;
    if (!form.childName.trim()) nextErrors.childName = messages.requiredField;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.childBirthDate))
      nextErrors.childBirthDate = messages.invalidBirthDate;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || !phoneNormalized) return;

    const suffix = crypto.randomUUID();
    const familyId = `family-${suffix}`;
    const representativeId = `representative-${suffix}`;
    const childId = `child-${suffix}`;
    const now = new Date().toISOString();
    const family = familySchema.parse({
      id: familyId,
      organizationId: workspace.organization.id,
      displayName: `Семья ${form.representativeName.trim()}`,
      primaryRepresentativeId: representativeId,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    const representative = representativeSchema.parse({
      id: representativeId,
      organizationId: workspace.organization.id,
      familyId,
      displayName: form.representativeName,
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
      displayName: form.childName,
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
          {field("representativeName", messages.representativeName)}
          {field("phone", messages.representativePhone, "tel")}
          <div className="grid gap-4 sm:grid-cols-2">
            {field("childName", messages.childName)}
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
