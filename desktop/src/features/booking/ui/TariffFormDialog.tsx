import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import {
  majorMoneyInput,
  parseMajorMoneyInput,
} from "@/features/booking/lib/bookingMoney";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  tariffSchema,
  type BookingTariff,
} from "@/features/booking/model/bookingCore";
import {
  createTariff,
  updateTariff,
} from "@/features/booking/model/bookingCommerce";
import { BookingFeedbackBanners } from "@/features/booking/ui/BookingWorkspaceState";
import { BookingSelect } from "@/features/booking/ui/BookingSelect";
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
import { Textarea } from "@/shared/ui/textarea";

type TariffForm = {
  id: string;
  name: string;
  description: string;
  price: string;
  currency: string;
  weeklyScheduleLimit: string;
  paymentDayMode: "inherited" | "custom";
  paymentDay: string;
};

type TariffFormErrors = Partial<
  Record<
    "name" | "price" | "currency" | "weeklyScheduleLimit" | "paymentDay",
    string
  >
>;

function createTariffId(): string {
  return `tariff-${crypto.randomUUID()}`;
}

function formFromTariff(
  tariff: BookingTariff | null,
  defaultCurrency: string,
  paymentDayOfMonth: number,
): TariffForm {
  if (!tariff) {
    return {
      id: createTariffId(),
      name: "",
      description: "",
      price: "",
      currency: defaultCurrency,
      weeklyScheduleLimit: "1",
      paymentDayMode: "inherited",
      paymentDay: String(paymentDayOfMonth),
    };
  }
  return {
    id: tariff.id,
    name: tariff.name,
    description: tariff.description ?? "",
    price: majorMoneyInput(tariff.priceMinor, tariff.currency),
    currency: tariff.currency,
    weeklyScheduleLimit: String(tariff.weeklyScheduleLimit),
    paymentDayMode:
      tariff.paymentDayOfMonth === undefined ? "inherited" : "custom",
    paymentDay: String(tariff.paymentDayOfMonth ?? paymentDayOfMonth),
  };
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

export function TariffFormDialog({
  onOpenChange,
  onSaved,
  open,
  tariff,
}: {
  onOpenChange: (open: boolean) => void;
  onSaved: (kind: "created" | "updated") => void;
  open: boolean;
  tariff: BookingTariff | null;
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace;
  const messages = getBookingAdminMessages(
    workspace?.organization.locale ?? "ru-RU",
  );
  const freshTariff = tariff
    ? (workspace?.tariffs.find((candidate) => candidate.id === tariff.id) ??
      null)
    : null;
  const defaultCurrency = workspace?.tariffs[0]?.currency ?? "RUB";
  const centerPaymentDay = workspace?.organization.paymentDayOfMonth ?? 5;
  const [form, setForm] = React.useState<TariffForm>(() =>
    formFromTariff(tariff, defaultCurrency, centerPaymentDay),
  );
  const [baseline, setBaseline] = React.useState<TariffForm | null>(null);
  const [errors, setErrors] = React.useState<TariffFormErrors>({});

  React.useEffect(() => {
    if (!open) return;
    const fresh = formFromTariff(
      freshTariff,
      defaultCurrency,
      centerPaymentDay,
    );
    setForm(fresh);
    setBaseline(fresh);
    setErrors({});
  }, [centerPaymentDay, defaultCurrency, freshTariff, open]);

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
    const nextErrors: TariffFormErrors = {};
    const currency = form.currency.trim().toUpperCase();
    const priceMinor = parseMajorMoneyInput(form.price, currency);
    const weeklyScheduleLimit = Number(form.weeklyScheduleLimit);
    const paymentDay = Number(form.paymentDay);

    if (!form.name.trim()) nextErrors.name = messages.requiredField;
    if (priceMinor === null) nextErrors.price = messages.invalidPrice;
    if (!/^[A-Z]{3}$/.test(currency)) {
      nextErrors.currency = messages.invalidCurrency;
    }
    if (
      !Number.isInteger(weeklyScheduleLimit) ||
      weeklyScheduleLimit < 1 ||
      weeklyScheduleLimit > 7
    ) {
      nextErrors.weeklyScheduleLimit = messages.invalidWeeklyScheduleLimit;
    }
    if (
      form.paymentDayMode === "custom" &&
      (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 28)
    ) {
      nextErrors.paymentDay = messages.invalidPaymentDay;
    }
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      return;
    }

    const now = new Date().toISOString();
    const parsed = tariffSchema.safeParse({
      id: form.id,
      organizationId: workspace.organization.id,
      name: form.name,
      ...(form.description.trim()
        ? { description: form.description.trim() }
        : {}),
      priceMinor: priceMinor ?? 0,
      currency,
      weeklyScheduleLimit,
      ...(form.paymentDayMode === "custom"
        ? { paymentDayOfMonth: paymentDay }
        : {}),
      status: freshTariff?.status ?? "active",
      createdAt: freshTariff?.createdAt ?? now,
      updatedAt: now,
    });
    if (!parsed.success) {
      setErrors({ price: messages.invalidPrice });
      return;
    }

    setErrors({});
    try {
      await booking.save((current) =>
        freshTariff
          ? updateTariff(current, parsed.data)
          : createTariff(current, parsed.data),
      );
      onSaved(freshTariff ? "updated" : "created");
      onOpenChange(false);
    } catch {
      // Shared feedback keeps the form open and explains persistence failures.
    }
  };

  return (
    <Dialog onOpenChange={requestOpenChange} open={open}>
      <DialogContent
        className="max-h-[calc(100dvh-2rem)] max-w-xl overflow-y-auto"
        data-testid="airhop-tariff-form"
      >
        <DialogHeader>
          <DialogTitle>
            {freshTariff
              ? messages.editTariffTitle
              : messages.createTariffTitle}
          </DialogTitle>
          <DialogDescription>
            {freshTariff
              ? messages.editTariffDescription
              : messages.createTariffDescription}
          </DialogDescription>
        </DialogHeader>
        <form className="space-y-5" onSubmit={(event) => void submit(event)}>
          <BookingFeedbackBanners />
          <Field error={errors.name} label={messages.tariffName}>
            <Input
              aria-label={messages.tariffName}
              data-testid="airhop-tariff-name"
              maxLength={160}
              onChange={(event) =>
                setForm((current) => ({ ...current, name: event.target.value }))
              }
              value={form.name}
            />
          </Field>
          <Field
            hint={messages.tariffDescriptionHint}
            label={messages.tariffDescription}
          >
            <Textarea
              aria-label={messages.tariffDescription}
              maxLength={4000}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  description: event.target.value,
                }))
              }
              rows={3}
              value={form.description}
            />
          </Field>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <Field error={errors.price} label={messages.tariffPrice}>
              <Input
                aria-label={messages.tariffPrice}
                data-testid="airhop-tariff-price"
                inputMode="decimal"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    price: event.target.value,
                  }))
                }
                value={form.price}
              />
            </Field>
            <Field error={errors.currency} label={messages.tariffCurrency}>
              <Input
                aria-label={messages.tariffCurrency}
                maxLength={3}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    currency: event.target.value.toUpperCase(),
                  }))
                }
                value={form.currency}
              />
            </Field>
          </div>
          <Field
            error={errors.weeklyScheduleLimit}
            hint={messages.tariffWeeklyScheduleLimitHint}
            label={messages.tariffWeeklyScheduleLimit}
          >
            <BookingSelect
              aria-label={messages.tariffWeeklyScheduleLimit}
              data-testid="airhop-tariff-weekly-limit"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  weeklyScheduleLimit: event.target.value,
                }))
              }
              value={form.weeklyScheduleLimit}
            >
              {[1, 2, 3, 4, 5, 6, 7].map((count) => (
                <option key={count} value={count}>
                  {messages.tariffPerWeek(count)}
                </option>
              ))}
            </BookingSelect>
          </Field>
          <Field
            hint={messages.tariffPaymentDayHint}
            label={messages.tariffPaymentDay}
          >
            <BookingSelect
              aria-label={messages.tariffPaymentDay}
              data-testid="airhop-tariff-payment-mode"
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  paymentDayMode: event.target
                    .value as TariffForm["paymentDayMode"],
                }))
              }
              value={form.paymentDayMode}
            >
              <option value="inherited">
                {messages.tariffPaymentDayInherited(centerPaymentDay)}
              </option>
              <option value="custom">{messages.tariffPaymentDayCustom}</option>
            </BookingSelect>
          </Field>
          {form.paymentDayMode === "custom" ? (
            <Field
              error={errors.paymentDay}
              label={messages.tariffPaymentDayCustomLabel}
            >
              <Input
                aria-label={messages.tariffPaymentDayCustomLabel}
                data-testid="airhop-tariff-payment-day"
                inputMode="numeric"
                max={28}
                min={1}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    paymentDay: event.target.value,
                  }))
                }
                type="number"
                value={form.paymentDay}
              />
            </Field>
          ) : null}
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
