import * as React from "react";
import type {
  AnalyticsUntil,
  CenterAnalyticsReport,
  StaffCenterAnalytics,
} from "../data/centerAnalyticsSchema";
import { buildCenterAnalyticsPreview } from "../lib/centerAnalytics";
import { CenterAnalyticsView } from "./CenterAnalyticsView";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { currentAirhopStaffDataRuntime } from "@/features/booking/data/staffDataRuntime";
import {
  createHttpStaffPaymentService,
  type StaffBookingFunnelAnalytics,
  type StaffPaymentAnalytics,
  type StaffPaymentAnalyticsCurrency,
  type StaffPaymentService,
} from "@/features/booking/data/staffPaymentService";
import {
  createHttpStaffSiteAnalyticsService,
  type CreateTrackingLink,
  type StaffSiteAnalytics,
  type StaffSiteAnalyticsService,
  type TrackingLinkList,
} from "@/features/booking/data/staffSiteAnalyticsService";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { organizationLocalDateTime } from "@/features/booking/lib/bookingDateTime";
import {
  buildBookingFunnelAnalytics,
  type BookingFunnelReport,
} from "@/features/booking/lib/bookingFunnelAnalytics";
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
import { BookingFunnelAnalyticsView } from "@/features/booking/ui/BookingFunnelAnalyticsView";
import { SiteAnalyticsView } from "@/features/booking/ui/SiteAnalyticsView";
import { TrackingLinksView } from "@/features/booking/ui/TrackingLinksView";
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

function PaymentAnalyticsContent({
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

function AnalyticsDashboard({
  centerReport,
  funnelReport,
  organization,
  paymentReport,
  siteAnalytics,
  trackingLinks,
  onCreateTrackingLink,
}: {
  centerReport: CenterAnalyticsReport;
  funnelReport?: BookingFunnelReport;
  organization: BookingOrganization;
  paymentReport?: PaymentAnalyticsReport;
  siteAnalytics?: StaffSiteAnalytics["analytics"];
  trackingLinks?: TrackingLinkList;
  onCreateTrackingLink?: (input: CreateTrackingLink) => Promise<void>;
}) {
  const messages = getBookingAdminMessages(organization.locale);
  const [selectedTab, setTab] = React.useState<
    "overview" | "sources" | "students" | "capacity" | "money" | "links"
  >("overview");
  const tab =
    selectedTab === "links" && !trackingLinks ? "overview" : selectedTab;
  const russian = organization.locale.toLowerCase().startsWith("ru");
  return (
    <div className="space-y-4">
      <fieldset
        className="flex flex-wrap gap-2"
        aria-label={messages.analyticsTitle}
      >
        {(
          [
            ["overview", russian ? "Обзор" : "Overview"],
            ["sources", russian ? "Привлечение" : "Acquisition"],
            ["students", russian ? "Ученики" : "Students"],
            ["capacity", russian ? "Загрузка" : "Capacity"],
            ["money", russian ? "Деньги" : "Money"],
            ["links", russian ? "Ссылки" : "Links"],
          ] as const
        )
          .filter(([key]) => key !== "links" || trackingLinks)
          .map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              aria-pressed={tab === key}
              variant={tab === key ? "default" : "outline"}
              onClick={() => setTab(key)}
            >
              {label}
            </Button>
          ))}
      </fieldset>
      {tab === "links" && trackingLinks && onCreateTrackingLink ? (
        <div className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {russian
              ? "Счётчики ссылок — за всю доступную историю. Фильтр периода не применяется."
              : "Link counts cover all retained history. The period filter does not apply."}
          </p>
          <TrackingLinksView
            links={trackingLinks.items}
            locale={organization.locale}
            onCreate={onCreateTrackingLink}
            redirectBaseUrl={trackingLinks.redirectBaseUrl}
          />
        </div>
      ) : tab !== "links" ? (
        <CenterAnalyticsView
          key={centerReport.generatedAt}
          locale={organization.locale}
          report={centerReport}
          section={tab}
        />
      ) : null}
      {tab === "sources" && siteAnalytics ? (
        <details className="rounded-xl border border-border p-4">
          <summary className="cursor-pointer font-medium">
            {russian
              ? "Подробно: сайт и форма записи"
              : "Details: website and booking form"}
          </summary>
          <div className="mt-4">
            <SiteAnalyticsView
              locale={organization.locale}
              report={siteAnalytics}
            />
          </div>
        </details>
      ) : null}
      {tab === "money" && paymentReport ? (
        <details className="rounded-xl border border-border p-4">
          <summary className="cursor-pointer font-medium">
            {russian
              ? "Начисления по расчётным месяцам · последние 6 месяцев"
              : "Billing periods · last 6 months"}
          </summary>
          <div className="mt-4">
            <PaymentAnalyticsContent
              organization={organization}
              report={paymentReport}
            />
          </div>
        </details>
      ) : null}
      {tab === "students" && funnelReport ? (
        <details className="rounded-xl border border-border p-4">
          <summary className="cursor-pointer font-medium">
            {russian
              ? "Пробные заявки по месяцам · последние 6 месяцев"
              : "Monthly trial cohorts · last 6 months"}
          </summary>
          <div className="mt-4">
            <BookingFunnelAnalyticsView
              organization={organization}
              report={funnelReport}
            />
          </div>
        </details>
      ) : null}
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
  const [period, setPeriod] = React.useState<AnalyticsPeriod>({
    days: 1,
    until: "yesterday",
  });
  return (
    <>
      <BookingFeedbackBanners />
      <p className="mb-3 text-xs text-muted-foreground">
        {workspace.organization.locale.startsWith("ru")
          ? "Демонстрационные данные браузера. Точная связь пробного с зачислением здесь не хранится; в приложении отчёт читается с сервера."
          : "Isolated browser preview. Exact trial-to-enrollment links are not retained here; the installed app reads server data."}
      </p>
      <AnalyticsPeriodPicker
        period={period}
        onChange={setPeriod}
        locale={workspace.organization.locale}
      />
      <AnalyticsDashboard
        centerReport={buildCenterAnalyticsPreview(
          workspace,
          period.days,
          period.until,
        )}
        funnelReport={buildBookingFunnelAnalytics(workspace, asOfDate)}
        organization={workspace.organization}
        paymentReport={buildPaymentAnalytics(
          workspace.paymentExpectations,
          asOfDate,
        )}
      />
    </>
  );
}

type AnalyticsPeriod = { days: number; until: AnalyticsUntil };

function AnalyticsPeriodPicker({
  period,
  onChange,
  locale,
}: {
  period: AnalyticsPeriod;
  onChange: (period: AnalyticsPeriod) => void;
  locale: string;
}) {
  const ru = locale.startsWith("ru");
  return (
    <fieldset
      className="mb-4 flex flex-wrap gap-2"
      aria-label={ru ? "Период аналитики" : "Analytics period"}
    >
      {(
        [
          { days: 1, until: "yesterday", label: ru ? "Вчера" : "Yesterday" },
          { days: 1, until: "today", label: ru ? "Сегодня" : "Today" },
          ...[7, 30, 90, 366].map((days) => ({
            days,
            until: "today" as const,
            label: `${days} ${ru ? "дн." : "days"}`,
          })),
        ] as const
      ).map((p) => (
        <Button
          key={p.label}
          size="sm"
          aria-pressed={period.days === p.days && period.until === p.until}
          variant={
            period.days === p.days && period.until === p.until
              ? "default"
              : "outline"
          }
          onClick={() => onChange({ days: p.days, until: p.until })}
        >
          {p.label}
        </Button>
      ))}
    </fieldset>
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
  const [siteService] = React.useState<StaffSiteAnalyticsService>(() =>
    createHttpStaffSiteAnalyticsService(),
  );
  const [payload, setPayload] = React.useState<{
    center: StaffCenterAnalytics;
    funnel?: StaffBookingFunnelAnalytics;
    payments?: StaffPaymentAnalytics;
    site?: StaffSiteAnalytics;
    trackingLinks?: TrackingLinkList;
  } | null>(null);
  const [error, setError] = React.useState<Error | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [period, setPeriod] = React.useState<AnalyticsPeriod>({
    days: 1,
    until: "yesterday",
  });
  const [partialError, setPartialError] = React.useState(false);
  const [extrasLoading, setExtrasLoading] = React.useState(false);
  const loadSequence = React.useRef(0);
  const locale =
    payload?.center.organization.locale ??
    booking.workspace?.organization.locale ??
    "ru-RU";
  const messages = getBookingAdminMessages(locale);
  const load = React.useCallback(async () => {
    const sequence = ++loadSequence.current;
    setLoading(true);
    setError(null);
    setPartialError(false);
    setExtrasLoading(false);
    try {
      const extraReports = Promise.allSettled([
        service.getPaymentAnalytics(),
        service.getBookingFunnelAnalytics(),
        siteService.getSiteAnalytics(period.days, period.until),
        siteService.listTrackingLinks(),
      ]);
      const center = await siteService.getCenterAnalytics(
        period.days,
        period.until,
      );
      if (sequence !== loadSequence.current) return;
      // The useful primary snapshot must not wait for optional read timeouts.
      setPayload({ center });
      setLoading(false);
      setExtrasLoading(true);
      const [payments, funnel, site, trackingLinks] = await extraReports;
      if (sequence === loadSequence.current) {
        setPayload({
          center,
          funnel: funnel.status === "fulfilled" ? funnel.value : undefined,
          payments:
            payments.status === "fulfilled" ? payments.value : undefined,
          site: site.status === "fulfilled" ? site.value : undefined,
          trackingLinks:
            trackingLinks.status === "fulfilled"
              ? trackingLinks.value
              : undefined,
        });
        setPartialError(
          [payments, funnel, site, trackingLinks].some(
            (result) => result.status === "rejected",
          ),
        );
      }
    } catch (cause) {
      if (sequence === loadSequence.current)
        setError(cause instanceof Error ? cause : new Error(String(cause)));
    } finally {
      if (sequence === loadSequence.current) {
        setLoading(false);
        setExtrasLoading(false);
      }
    }
  }, [period, service, siteService]);

  const createTrackingLink = React.useCallback(
    async (input: CreateTrackingLink) => {
      await siteService.createTrackingLink(input);
      const trackingLinks = await siteService.listTrackingLinks();
      setPayload((current) =>
        current ? { ...current, trackingLinks } : current,
      );
    },
    [siteService],
  );

  React.useEffect(() => {
    void load();
    return () => {
      loadSequence.current += 1;
    };
  }, [load]);

  return (
    <AnalyticsFrame locale={locale}>
      <div
        className="mb-4 flex flex-wrap items-center gap-2"
        aria-busy={loading}
      >
        <AnalyticsPeriodPicker
          period={period}
          onChange={setPeriod}
          locale={locale}
        />
        <Button
          size="sm"
          variant="ghost"
          disabled={loading}
          onClick={() => void load()}
        >
          {locale.startsWith("ru") ? "Обновить" : "Refresh"}
        </Button>
      </div>
      {loading && payload ? (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {locale.startsWith("ru")
            ? "Обновляю данные. Ниже пока предыдущий снимок."
            : "Refreshing. The previous snapshot remains below."}
        </p>
      ) : null}
      {partialError && !loading ? (
        <p role="status" className="mb-3 text-sm text-destructive">
          {locale.startsWith("ru")
            ? "Обзор центра загружен, но часть дополнительных отчётов недоступна. Нажмите «Обновить», чтобы повторить."
            : "Center report loaded; some additional reports are unavailable. Refresh to retry."}
        </p>
      ) : null}
      {extrasLoading ? (
        <p role="status" className="mb-3 text-sm text-muted-foreground">
          {locale.startsWith("ru")
            ? "Обзор готов. Дополнительные отчёты ещё загружаются."
            : "Overview ready. Additional reports are still loading."}
        </p>
      ) : null}
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
        <AnalyticsDashboard
          centerReport={payload.center.analytics}
          funnelReport={payload.funnel?.analytics}
          organization={payload.center.organization}
          onCreateTrackingLink={createTrackingLink}
          paymentReport={payload.payments?.analytics}
          siteAnalytics={payload.site?.analytics}
          trackingLinks={payload.trackingLinks}
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
