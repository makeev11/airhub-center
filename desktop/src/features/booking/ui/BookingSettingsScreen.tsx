import * as React from "react";
import { CheckCircle2, Moon, Sun, SunMoon } from "lucide-react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import {
  currencyMinorUnitExponent,
  majorMoneyInput,
  parseMajorMoneyInput,
} from "@/features/booking/lib/bookingAdmin";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  AUTO_BOOKING_TIME_ZONE_VALUE,
  bookingTimeZoneOptions,
  detectBookingTimeZone,
} from "@/features/booking/lib/bookingTimeZones";
import { organizationSchema } from "@/features/booking/model/bookingCore";
import type {
  PublicBookingAppearance,
  PublicBookingPurpose,
} from "@/features/booking/model/bookingCore";
import {
  BookingFeedbackBanners,
  BookingWorkspaceGate,
} from "@/features/booking/ui/BookingWorkspaceState";
import { BookingSelect } from "@/features/booking/ui/BookingSelect";
import { BookingSettingsNav } from "@/features/booking/ui/BookingSettingsNav";
import { useBookingUnsavedChangesGuard } from "@/features/booking/ui/useBookingUnsavedChangesGuard";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Button } from "@/shared/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Input } from "@/shared/ui/input";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Switch } from "@/shared/ui/switch";
import { cn } from "@/shared/lib/cn";

type SettingsForm = {
  name: string;
  locale: string;
  timeZone: string;
  trialMode: "disabled" | "free" | "paid";
  currency: string;
  price: string;
  paymentDay: string;
  attendance: boolean;
  singleVisits: boolean;
  publicBookingPurpose: PublicBookingPurpose;
  publicBookingAppearance: PublicBookingAppearance;
};

type SettingsErrors = Partial<
  Record<"name" | "timeZone" | "currency" | "price" | "paymentDay", string>
>;

function formFromOrganization(
  organization: ReturnType<typeof organizationSchema.parse>,
): SettingsForm {
  const paid =
    organization.defaultTrialPolicy.mode === "paid"
      ? organization.defaultTrialPolicy.price
      : null;
  const currency = paid?.currency ?? "RUB";
  return {
    name: organization.name,
    locale: organization.locale,
    timeZone: organization.timeZone,
    trialMode: organization.defaultTrialPolicy.mode,
    currency,
    price: majorMoneyInput(paid?.amountMinor ?? 0, currency),
    paymentDay: String(organization.paymentDayOfMonth),
    attendance: organization.trackAttendanceByDefault,
    singleVisits: organization.allowSingleVisitsByDefault,
    publicBookingPurpose: organization.publicBooking.purpose,
    publicBookingAppearance: organization.publicBooking.appearance,
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

function SettingsFormContent({
  section,
}: {
  section: "organization" | "public-booking";
}) {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace as NonNullable<typeof booking.workspace>;
  const messages = getBookingAdminMessages(workspace.organization.locale);
  const detectedTimeZone = React.useMemo(() => detectBookingTimeZone(), []);
  const [form, setForm] = React.useState<SettingsForm>(() =>
    formFromOrganization(workspace.organization),
  );
  const [baseline, setBaseline] = React.useState<SettingsForm>(() =>
    formFromOrganization(workspace.organization),
  );
  const [errors, setErrors] = React.useState<SettingsErrors>({});
  const [saved, setSaved] = React.useState(false);
  const sourceRevisionRef = React.useRef(workspace.revision);
  const dirty = JSON.stringify(form) !== JSON.stringify(baseline);
  const timeZoneOptions = React.useMemo(
    () => bookingTimeZoneOptions(form.timeZone),
    [form.timeZone],
  );

  React.useEffect(() => {
    if (sourceRevisionRef.current === workspace.revision) return;
    const fresh = formFromOrganization(workspace.organization);
    sourceRevisionRef.current = workspace.revision;
    setForm(fresh);
    setBaseline(fresh);
    setErrors({});
  }, [workspace.organization, workspace.revision]);

  useBookingUnsavedChangesGuard(dirty, messages.unsavedChangesConfirm);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaved(false);
    const nextErrors: SettingsErrors = {};
    if (!form.name.trim()) nextErrors.name = messages.requiredField;
    const currency = form.currency.trim().toUpperCase();
    const currencyIsValid = currencyMinorUnitExponent(currency) !== null;
    const amountMinor =
      form.trialMode === "paid" && currencyIsValid
        ? parseMajorMoneyInput(form.price, currency)
        : null;
    const paymentDay = Number(form.paymentDay);
    if (form.trialMode === "paid" && !currencyIsValid) {
      nextErrors.currency = messages.invalidCurrency;
    }
    if (form.trialMode === "paid" && currencyIsValid && amountMinor === null) {
      nextErrors.price = messages.invalidPrice;
    }
    if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 28) {
      nextErrors.paymentDay = messages.invalidPaymentDay;
    }
    const organization = {
      ...workspace.organization,
      name: form.name,
      locale: form.locale,
      timeZone: form.timeZone,
      paymentDayOfMonth: paymentDay,
      defaultTrialPolicy:
        form.trialMode === "paid"
          ? {
              mode: "paid" as const,
              price: {
                amountMinor: amountMinor ?? 0,
                currency,
              },
            }
          : { mode: form.trialMode },
      trackAttendanceByDefault: form.attendance,
      allowSingleVisitsByDefault: form.singleVisits,
      publicBooking: {
        purpose: form.publicBookingPurpose,
        appearance: form.publicBookingAppearance,
      },
    };
    const parsed = organizationSchema.safeParse(organization);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        if (issue.path[0] === "timeZone") {
          nextErrors.timeZone = messages.invalidTimeZone;
        }
      }
    }
    if (Object.keys(nextErrors).length || !parsed.success) {
      setErrors(nextErrors);
      return;
    }
    setErrors({});
    try {
      await booking.save((current) => {
        const { revision: _revision, ...draft } = current;
        return { ...draft, organization: parsed.data };
      });
      setSaved(true);
    } catch {
      // The provider renders storage and revision failures in a shared banner.
    }
  };

  return (
    <form className="space-y-5" onSubmit={(event) => void submit(event)}>
      <BookingFeedbackBanners />
      {saved ? (
        <Alert data-testid="airhop-settings-saved">
          <AlertDescription className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            {messages.settingsSaved}
          </AlertDescription>
        </Alert>
      ) : null}
      {section === "organization" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {messages.organizationCardTitle}
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-5 lg:grid-cols-2">
            <Field error={errors.name} label={messages.organizationName}>
              <Input
                aria-label={messages.organizationName}
                data-testid="airhop-settings-name"
                maxLength={160}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
                value={form.name}
              />
            </Field>
            <Field label={messages.locale}>
              <BookingSelect
                aria-label={messages.locale}
                data-testid="airhop-settings-locale"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    locale: event.target.value,
                  }))
                }
                value={form.locale}
              >
                <option value="ru-RU">{messages.localeRussian}</option>
                <option value="en-US">{messages.localeEnglish}</option>
              </BookingSelect>
            </Field>
            <Field
              error={errors.timeZone}
              hint={messages.timeZoneHint}
              label={messages.timeZone}
            >
              <BookingSelect
                aria-label={messages.timeZone}
                data-testid="airhop-settings-time-zone"
                onChange={(event) => {
                  const timeZone =
                    event.target.value === AUTO_BOOKING_TIME_ZONE_VALUE
                      ? detectedTimeZone
                      : event.target.value;
                  setForm((current) => ({ ...current, timeZone }));
                }}
                value={form.timeZone}
              >
                <option value={AUTO_BOOKING_TIME_ZONE_VALUE}>
                  {messages.timeZoneAutomatic(detectedTimeZone)}
                </option>
                {timeZoneOptions.map((timeZone) => (
                  <option key={timeZone} value={timeZone}>
                    {timeZone}
                  </option>
                ))}
              </BookingSelect>
            </Field>
            <Field
              error={errors.paymentDay}
              hint={messages.centerPaymentDayHint}
              label={messages.centerPaymentDay}
            >
              <Input
                aria-label={messages.centerPaymentDay}
                data-testid="airhop-settings-payment-day"
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
            <Field label={messages.trialPolicy}>
              <BookingSelect
                aria-label={messages.trialPolicy}
                data-testid="airhop-settings-trial-policy"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    trialMode: event.target.value as SettingsForm["trialMode"],
                  }))
                }
                value={form.trialMode}
              >
                <option value="disabled">{messages.trialDisabled}</option>
                <option value="free">{messages.trialFree}</option>
                <option value="paid">{messages.trialPaid}</option>
              </BookingSelect>
            </Field>
            {form.trialMode === "paid" ? (
              <>
                <Field error={errors.currency} label={messages.currency}>
                  <Input
                    aria-label={messages.currency}
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
                <Field error={errors.price} label={messages.trialPrice}>
                  <Input
                    aria-label={messages.trialPrice}
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
              </>
            ) : null}
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 p-4 lg:col-span-2">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {messages.attendanceDefault}
                </p>
                <p className="text-xs text-muted-foreground">
                  {messages.attendanceHint}
                </p>
              </div>
              <Switch
                aria-label={messages.attendanceDefault}
                checked={form.attendance}
                onCheckedChange={(attendance) =>
                  setForm((current) => ({ ...current, attendance }))
                }
              />
            </div>
            <div className="flex items-start justify-between gap-4 rounded-xl border border-border/70 p-4 lg:col-span-2">
              <div className="space-y-1">
                <p className="text-sm font-medium">
                  {messages.singleVisitsDefault}
                </p>
                <p className="text-xs text-muted-foreground">
                  {messages.singleVisitsHint}
                </p>
              </div>
              <Switch
                aria-label={messages.singleVisitsDefault}
                checked={form.singleVisits}
                data-testid="airhop-settings-single-visits"
                onCheckedChange={(singleVisits) =>
                  setForm((current) => ({ ...current, singleVisits }))
                }
              />
            </div>
          </CardContent>
        </Card>
      ) : null}
      {section === "public-booking" ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">
              {messages.publicBookingCardTitle}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {messages.publicBookingCardDescription}
            </p>
          </CardHeader>
          <CardContent className="grid gap-6">
            <Field
              hint={messages.publicBookingPurposeHint}
              label={messages.publicBookingPurpose}
            >
              <BookingSelect
                aria-label={messages.publicBookingPurpose}
                data-testid="airhop-settings-public-purpose"
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    publicBookingPurpose: event.target
                      .value as PublicBookingPurpose,
                  }))
                }
                value={form.publicBookingPurpose}
              >
                <option value="trial">
                  {messages.publicBookingPurposeTrial}
                </option>
                <option value="lesson">
                  {messages.publicBookingPurposeLesson}
                </option>
              </BookingSelect>
            </Field>
            <Field
              hint={messages.publicBookingAppearanceHint}
              label={messages.publicBookingAppearance}
            >
              <div className="grid gap-2 sm:grid-cols-3">
                {(
                  [
                    {
                      value: "automatic" as const,
                      label: messages.publicBookingAppearanceAutomatic,
                      Icon: SunMoon,
                    },
                    {
                      value: "light" as const,
                      label: messages.publicBookingAppearanceLight,
                      Icon: Sun,
                    },
                    {
                      value: "dark" as const,
                      label: messages.publicBookingAppearanceDark,
                      Icon: Moon,
                    },
                  ] as const
                ).map(({ value, label, Icon }) => (
                  <button
                    aria-pressed={form.publicBookingAppearance === value}
                    className={cn(
                      "flex min-h-11 items-center gap-3 rounded-xl border px-4 py-3 text-left text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-ring",
                      form.publicBookingAppearance === value
                        ? "border-primary bg-primary/10"
                        : "border-border/70 hover:bg-muted/60",
                    )}
                    data-testid={`airhop-settings-public-appearance-${value}`}
                    key={value}
                    onClick={() =>
                      setForm((current) => ({
                        ...current,
                        publicBookingAppearance: value,
                      }))
                    }
                    type="button"
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          </CardContent>
        </Card>
      ) : null}
      <div className="flex justify-end">
        <Button disabled={booking.isSaving || !dirty} type="submit">
          {booking.isSaving ? messages.saving : messages.save}
        </Button>
      </div>
    </form>
  );
}

export function BookingSettingsScreen({
  section,
}: {
  section: "organization" | "public-booking";
}) {
  const booking = useBookingWorkspace();
  const messages = getBookingAdminMessages(
    booking.workspace?.organization.locale ?? "ru-RU",
  );
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-6 py-5">
        <PageHeader
          description={
            section === "organization"
              ? messages.settingsDescription
              : messages.publicBookingCardDescription
          }
          title={
            section === "organization"
              ? messages.settingsTitle
              : messages.publicBookingCardTitle
          }
        />
        <BookingSettingsNav active={section} className="mt-4" />
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-4xl">
          <BookingWorkspaceGate>
            {() => <SettingsFormContent section={section} />}
          </BookingWorkspaceGate>
        </div>
      </div>
    </div>
  );
}
