import * as React from "react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { currentAirhopStaffDataRuntime } from "@/features/booking/data/staffDataRuntime";
import {
  createHttpStaffPaymentService,
  type StaffPaymentAnalytics,
  type StaffPaymentAnalyticsCurrency,
  type StaffPaymentService,
} from "@/features/booking/data/staffPaymentService";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { organizationLocalDateTime } from "@/features/booking/lib/bookingDateTime";
import { createBookingFormatters } from "@/features/booking/lib/bookingLocale";
import {
  buildPaymentAnalytics,
  type PaymentAnalyticsReport,
} from "@/features/booking/lib/bookingPaymentAnalytics";
import type { BookingOrganization } from "@/features/booking/model/bookingCore";
import {
  BookingFeedbackBanners,
  BookingWorkspaceGate,
} from "@/features/booking/ui/BookingWorkspaceState";
import { Alert, AlertDescription } from "@/shared/ui/alert";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { PageHeader } from "@/shared/ui/PageHeader";
import { Progress } from "@/shared/ui/progress";

function paymentShare(locale: string, basisPoints: number | null): string {
  if (basisPoints === null) return "—";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(basisPoints / 10_000);
}

function monthLabel(locale: string, periodStart: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${periodStart}T12:00:00Z`));
}

function AnalyticsMetric({
  detail,
  label,
  tone = "default",
  value,
}: {
  detail: string;
  label: string;
  tone?: "default" | "danger";
  value: string;
}) {
  return (
    <Card className="min-w-0 space-y-2 p-4 sm:p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={
          tone === "danger"
            ? "break-words text-2xl font-semibold tabular-nums text-destructive"
            : "break-words text-2xl font-semibold tabular-nums"
        }
      >
        {value}
      </p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

function CurrencyAnalytics({
  currency,
  locale,
}: {
  currency: StaffPaymentAnalyticsCurrency;
  locale: string;
}) {
  const messages = getBookingAdminMessages(locale);
  const formatters = createBookingFormatters(locale);
  const current = currency.periods.at(-1);
  if (!current) return null;
  const count = messages.analyticsPaymentsCount;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
        <AnalyticsMetric
          detail={count(current.paidCount)}
          label={messages.analyticsPaidThisMonth}
          value={formatters.money(current.paidMinor, currency.currency)}
        />
        <AnalyticsMetric
          detail={messages.analyticsOpenTotal(
            formatters.money(currency.openMinor, currency.currency),
            count(currency.openCount),
          )}
          label={messages.analyticsOutstandingThisMonth}
          value={formatters.money(current.outstandingMinor, currency.currency)}
        />
        <AnalyticsMetric
          detail={count(currency.overdueCount)}
          label={messages.analyticsOverdueTotal}
          tone={currency.overdueCount > 0 ? "danger" : "default"}
          value={formatters.money(currency.overdueMinor, currency.currency)}
        />
        <AnalyticsMetric
          detail={messages.analyticsPaidShareHint}
          label={messages.analyticsPaidShare}
          value={paymentShare(locale, current.paidShareBps)}
        />
      </div>

      <Card className="space-y-5 p-4 sm:p-5">
        <div>
          <h2 className="text-base font-semibold">
            {messages.analyticsTrendTitle}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {messages.analyticsTrendDescription}
          </p>
        </div>
        <div className="space-y-5">
          {currency.periods.map((period) => (
            <div className="space-y-2" key={period.periodStart}>
              <div className="flex min-w-0 items-start justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium capitalize">
                    {monthLabel(locale, period.periodStart)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {messages.analyticsScheduled}:{" "}
                    {formatters.money(period.scheduledMinor, currency.currency)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {period.overdueCount > 0 ? (
                    <Badge variant="destructive">
                      {formatters.money(period.overdueMinor, currency.currency)}
                    </Badge>
                  ) : null}
                  <span className="font-medium tabular-nums">
                    {paymentShare(locale, period.paidShareBps)}
                  </span>
                </div>
              </div>
              <Progress
                aria-label={`${monthLabel(locale, period.periodStart)}: ${messages.analyticsPaidShare}`}
                value={(period.paidShareBps ?? 0) / 100}
              />
              <div className="flex justify-between gap-3 text-xs text-muted-foreground">
                <span>
                  {messages.paymentPaid}:{" "}
                  {formatters.money(period.paidMinor, currency.currency)}
                </span>
                <span>{count(period.scheduledCount)}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function AnalyticsContent({
  organization,
  report,
}: {
  organization: BookingOrganization;
  report: PaymentAnalyticsReport;
}) {
  const messages = getBookingAdminMessages(organization.locale);
  const formatters = createBookingFormatters(organization.locale);
  const [selectedCurrency, setSelectedCurrency] = React.useState(
    report.currencies[0]?.currency ?? "",
  );
  const selected =
    report.currencies.find(({ currency }) => currency === selectedCurrency) ??
    report.currencies[0];

  return (
    <div className="space-y-4" data-testid="airhop-payment-analytics">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {messages.analyticsAsOf(formatters.date(report.asOfDate))}
        </p>
        {report.currencies.length > 1 ? (
          <fieldset className="flex gap-2 overflow-x-auto">
            <legend className="sr-only">{messages.currency}</legend>
            {report.currencies.map(({ currency }) => (
              <Button
                aria-pressed={selected?.currency === currency}
                key={currency}
                onClick={() => setSelectedCurrency(currency)}
                size="sm"
                variant={
                  selected?.currency === currency ? "default" : "outline"
                }
              >
                {currency}
              </Button>
            ))}
          </fieldset>
        ) : null}
      </div>
      {selected ? (
        <CurrencyAnalytics currency={selected} locale={organization.locale} />
      ) : (
        <Card className="space-y-2 p-8 text-center">
          <h2 className="text-lg font-semibold">
            {messages.analyticsNoDataTitle}
          </h2>
          <p className="text-sm text-muted-foreground">
            {messages.analyticsNoDataDescription}
          </p>
        </Card>
      )}
    </div>
  );
}

function AnalyticsFrame({
  children,
  locale,
}: {
  children: React.ReactNode;
  locale: string;
}) {
  const messages = getBookingAdminMessages(locale);
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-tl-xl bg-background">
      <header className="shrink-0 border-b border-border/70 px-4 py-4 sm:px-6 sm:py-5">
        <PageHeader
          description={messages.analyticsDescription}
          title={messages.analyticsTitle}
        />
      </header>
      <div className="min-h-0 flex-1 overflow-auto p-4 sm:p-6">{children}</div>
    </div>
  );
}

function WorkspaceAnalyticsContent() {
  const booking = useBookingWorkspace();
  const workspace = booking.workspace as NonNullable<typeof booking.workspace>;
  const asOfDate = organizationLocalDateTime(
    workspace.organization.timeZone,
    new Date(),
  ).date;
  return (
    <>
      <BookingFeedbackBanners />
      <AnalyticsContent
        organization={workspace.organization}
        report={buildPaymentAnalytics(workspace.paymentExpectations, asOfDate)}
      />
    </>
  );
}

function WorkspacePaymentAnalyticsScreen() {
  const booking = useBookingWorkspace();
  const locale = booking.workspace?.organization.locale ?? "ru-RU";
  return (
    <AnalyticsFrame locale={locale}>
      <BookingWorkspaceGate>
        {() => <WorkspaceAnalyticsContent />}
      </BookingWorkspaceGate>
    </AnalyticsFrame>
  );
}

function ServerPaymentAnalyticsScreen() {
  const booking = useBookingWorkspace();
  const [service] = React.useState<StaffPaymentService>(() =>
    createHttpStaffPaymentService(),
  );
  const [payload, setPayload] = React.useState<StaffPaymentAnalytics | null>(
    null,
  );
  const [error, setError] = React.useState<Error | null>(null);
  const [loading, setLoading] = React.useState(true);
  const locale =
    payload?.organization.locale ??
    booking.workspace?.organization.locale ??
    "ru-RU";
  const messages = getBookingAdminMessages(locale);
  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setPayload(await service.getPaymentAnalytics());
    } catch (cause) {
      setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      setLoading(false);
    }
  }, [service]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return (
    <AnalyticsFrame locale={locale}>
      {loading && !payload ? (
        <Card className="space-y-2 p-8 text-center">
          <h2 className="text-lg font-semibold">{messages.loadingTitle}</h2>
          <p className="text-sm text-muted-foreground">
            {messages.loadingDescription}
          </p>
        </Card>
      ) : error || !payload ? (
        <Alert variant="destructive">
          <AlertDescription className="space-y-3">
            <p>{error?.message ?? messages.loadErrorDescription}</p>
            <Button onClick={() => void load()} size="sm" variant="outline">
              {messages.retry}
            </Button>
          </AlertDescription>
        </Alert>
      ) : (
        <AnalyticsContent
          organization={payload.organization}
          report={payload.analytics}
        />
      )}
    </AnalyticsFrame>
  );
}

/** Uses PostgreSQL analytics in Tauri and isolated workspace data in previews. */
export function PaymentAnalyticsScreen() {
  return currentAirhopStaffDataRuntime() === "server" ? (
    <ServerPaymentAnalyticsScreen />
  ) : (
    <WorkspacePaymentAnalyticsScreen />
  );
}
