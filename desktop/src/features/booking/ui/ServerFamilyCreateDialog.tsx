import * as React from "react";
import { toast } from "sonner";

import {
  createHttpStaffFamilyLifecycleService,
  StaffFamilyLifecycleApiError,
} from "@/features/booking/data/staffFamilyLifecycleService";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { airHopTodayIsoDate } from "@/features/booking/lib/airHopDateInput";
import { normalizePublicBookingPhone } from "@/features/booking/model/publicBooking";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
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

type FormState = {
  familyName: string;
  representativeFirstName: string;
  representativeLastName: string;
  phone: string;
  childFirstName: string;
  childLastName: string;
  childBirthDate: string;
};

const EMPTY_FORM: FormState = {
  familyName: "",
  representativeFirstName: "",
  representativeLastName: "",
  phone: "",
  childFirstName: "",
  childLastName: "",
  childBirthDate: "",
};

/** Creates a complete Booking Core family aggregate in one audited command. */
export function ServerFamilyCreateDialog({
  onCreated,
  onOpenChange,
  open,
}: {
  onCreated: (familyId: string) => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const locale = useAirHopLocale();
  const messages = getBookingAdminMessages(locale);
  const service = React.useMemo(
    () => createHttpStaffFamilyLifecycleService(),
    [],
  );
  const [form, setForm] = React.useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = React.useState<Record<string, string>>({});
  const [requestError, setRequestError] = React.useState<string | null>(null);
  const [isSaving, setIsSaving] = React.useState(false);

  React.useEffect(() => {
    if (!open) return;
    setForm(EMPTY_FORM);
    setErrors({});
    setRequestError(null);
  }, [open]);

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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(form.childBirthDate)) {
      nextErrors.childBirthDate = messages.invalidBirthDate;
    }
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length || !phoneNormalized) return;

    setIsSaving(true);
    setRequestError(null);
    try {
      const representativeName = [
        form.representativeFirstName.trim(),
        form.representativeLastName.trim(),
      ].join(" ");
      const childName = [
        form.childFirstName.trim(),
        form.childLastName.trim(),
      ].join(" ");
      const result = await service.createFamily({
        displayName: form.familyName.trim(),
        representativeName,
        representativeFirstName: form.representativeFirstName,
        representativeLastName: form.representativeLastName,
        phone: form.phone,
        childName,
        childFirstName: form.childFirstName,
        childLastName: form.childLastName,
        childBirthDate: form.childBirthDate,
      });
      toast.success(messages.familyCreated);
      onCreated(result.familyId);
      onOpenChange(false);
    } catch (error) {
      setRequestError(
        error instanceof StaffFamilyLifecycleApiError
          ? error.message
          : messages.saveErrorDescription,
      );
    } finally {
      setIsSaving(false);
    }
  };

  const field = (
    key: keyof FormState,
    label: string,
    type: React.HTMLInputTypeAttribute = "text",
  ) => (
    <label
      className="grid gap-1.5 text-sm"
      htmlFor={`airhop-server-family-${key}`}
    >
      <span className="font-medium">{label}</span>
      {type === "date" ? (
        <AirHopDateInput
          aria-label={label}
          data-testid={`airhop-server-family-${key}`}
          id={`airhop-server-family-${key}`}
          max={airHopTodayIsoDate()}
          onChange={(value) =>
            setForm((current) => ({ ...current, [key]: value }))
          }
          value={form[key]}
        />
      ) : (
        <Input
          aria-label={label}
          data-testid={`airhop-server-family-${key}`}
          id={`airhop-server-family-${key}`}
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
      <DialogContent
        className="max-w-xl"
        data-testid="airhop-server-family-create-form"
      >
        <DialogHeader>
          <DialogTitle>{messages.createFamilyTitle}</DialogTitle>
          <DialogDescription>
            {messages.createFamilyDescription}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-4" onSubmit={(event) => void submit(event)}>
          {requestError ? (
            <Alert variant="destructive">
              <AlertDescription>{requestError}</AlertDescription>
            </Alert>
          ) : null}
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
