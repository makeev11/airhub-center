import type { StaffSiteAnalyticsReport } from "@/features/booking/data/staffSiteAnalyticsService";
import { Card } from "@/shared/ui/card";
import { Progress } from "@/shared/ui/progress";
import { SiteAnalyticsDetails } from "./SiteAnalyticsDetails";
import { organizationLocalDateTime } from "../lib/bookingDateTime";

function percent(locale: string, basisPoints: number | null): string {
  if (basisPoints === null) return "—";
  return new Intl.NumberFormat(locale, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(basisPoints / 10_000);
}

function date(locale: string, value: string): string {
  return new Intl.DateTimeFormat(locale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function copy(locale: string) {
  const ru = locale.toLowerCase().startsWith("ru");
  return ru
    ? {
        period: (from: string, to: string) => `Период ${from} — ${to}`,
        visitors: "Посетители",
        sessions: "Сессии",
        bookingOpens: "Открыли запись",
        bookings: "Записи созданы",
        contacts: "Клики по контактам",
        conversion: "Конверсия в запись",
        conversionHint:
          "Из попыток, открытых в этом периоде, завершили запись в этом же периоде",
        trend: "Что происходило по дням",
        trendHint: "Сессии, созданные записи и клики по контактам.",
        funnel: "Воронка записи",
        funnelHint:
          "Наблюдаемые этапы попыток, открытых в этом периоде. Блокировщики могут скрывать отдельные этапы.",
        sources: "Источники",
        sourcesHint:
          "Первый наблюдаемый источник каждой сессии в периоде. Переходы по ссылкам могут включать роботов.",
        noSources: "Источники появятся после первых переходов.",
        source: "Источник",
        opens: "Переходы",
        stages: [
          "Открыли форму",
          "Выбрали филиал и возраст",
          "Выбрали группу",
          "Выбрали занятие",
          "Заполнили контакты",
          "Проверили данные",
          "Нажали «Записаться»",
          "Запись создана",
        ],
      }
    : {
        period: (from: string, to: string) => `Period ${from} — ${to}`,
        visitors: "Visitors",
        sessions: "Sessions",
        bookingOpens: "Booking opens",
        bookings: "Bookings created",
        contacts: "Contact clicks",
        conversion: "Booking conversion",
        conversionHint:
          "Journeys opened in this period that also created a booking within this period",
        trend: "Daily activity",
        trendHint: "Sessions, committed bookings, and contact clicks.",
        funnel: "Booking funnel",
        funnelHint:
          "Observed stages of journeys opened in this period. Blockers may hide individual stages.",
        sources: "Sources",
        sourcesHint: "Tracked links and ordinary sources in one view.",
        noSources: "Sources will appear after the first visits.",
        source: "Source",
        opens: "Visits",
        stages: [
          "Opened booking",
          "Selected branch and age",
          "Selected group",
          "Selected lesson",
          "Completed contacts",
          "Reviewed details",
          "Submitted",
          "Booking created",
        ],
      };
}

function Metric({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="min-w-0 space-y-2 p-4 sm:p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="break-words text-2xl font-semibold tabular-nums">{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </Card>
  );
}

export function SiteAnalyticsView({
  locale,
  report,
}: {
  locale: string;
  report: StaffSiteAnalyticsReport;
}) {
  const messages = copy(locale);
  const partial =
    report.asOfDate ===
    organizationLocalDateTime(report.timeZone, new Date(report.generatedAt))
      .date;
  const number = new Intl.NumberFormat(locale);
  const maxSessions = Math.max(1, ...report.days.map((day) => day.sessions));
  const funnelValues = [
    report.funnel.opened,
    report.funnel.basicsCompleted,
    report.funnel.groupsCompleted,
    report.funnel.occurrencesCompleted,
    report.funnel.contactCompleted,
    report.funnel.previewCompleted,
    report.funnel.submitted,
    report.funnel.created,
  ];

  return (
    <div className="space-y-4" data-testid="airhop-site-analytics">
      <p className="text-sm text-muted-foreground">
        {messages.period(
          date(locale, report.periodStart),
          date(locale, report.asOfDate),
        )}
      </p>
      <p className="text-xs text-muted-foreground">
        {locale.startsWith("ru") ? "Часовой пояс: " : "Timezone: "}
        {report.timeZone}
        {locale.startsWith("ru")
          ? `${partial ? ". Сегодняшний день ещё не завершён" : ". Завершённые календарные дни"}. Посетитель — отдельный браузер.`
          : `${partial ? ". Today is partial" : ". Complete calendar days"}. A visitor represents a browser.`}
      </p>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-6">
        <Metric
          label={messages.visitors}
          value={number.format(report.totals.visitors)}
        />
        <Metric
          label={messages.sessions}
          value={number.format(report.totals.sessions)}
        />
        <Metric
          label={messages.bookingOpens}
          value={number.format(report.totals.bookingOpens)}
        />
        <Metric
          label={messages.bookings}
          value={number.format(report.totals.bookingsCreated)}
        />
        <Metric
          label={messages.contacts}
          value={number.format(report.totals.contactClicks)}
        />
        <Metric
          hint={messages.conversionHint}
          label={messages.conversion}
          value={percent(locale, report.totals.bookingConversionBps)}
        />
      </div>

      <SiteAnalyticsDetails locale={locale} report={report} />

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-5 p-4 sm:p-5">
          <div>
            <h2 className="text-base font-semibold">{messages.funnel}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {messages.funnelHint}
            </p>
          </div>
          <div className="space-y-4">
            {funnelValues.map((value, index) => (
              <div className="space-y-1.5" key={messages.stages[index]}>
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span>{messages.stages[index]}</span>
                  <span className="font-medium tabular-nums">
                    {number.format(value)}
                  </span>
                </div>
                <Progress
                  aria-label={messages.stages[index]}
                  value={
                    report.funnel.opened
                      ? (value * 100) / report.funnel.opened
                      : 0
                  }
                />
              </div>
            ))}
          </div>
        </Card>

        <Card className="space-y-5 p-4 sm:p-5">
          <div>
            <h2 className="text-base font-semibold">{messages.trend}</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {messages.trendHint}
            </p>
          </div>
          <div className="max-h-96 space-y-3 overflow-y-auto pr-1">
            {report.days.map((day) => (
              <div
                className="grid grid-cols-[5rem_minmax(0,1fr)_auto] items-center gap-3"
                key={day.date}
              >
                <span className="text-xs text-muted-foreground">
                  {date(locale, day.date)}
                </span>
                <Progress
                  aria-label={`${messages.sessions}: ${day.sessions}`}
                  value={(day.sessions * 100) / maxSessions}
                />
                <span className="text-xs tabular-nums text-muted-foreground">
                  {day.sessions} · {day.bookingsCreated} · {day.contactClicks}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card className="space-y-4 p-4 sm:p-5">
        <div>
          <h2 className="text-base font-semibold">{messages.sources}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {messages.sourcesHint}
          </p>
        </div>
        {report.sources.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="text-xs text-muted-foreground">
                <tr>
                  <th className="pb-3 font-medium">{messages.source}</th>
                  <th className="pb-3 text-right font-medium">
                    {messages.sessions}
                  </th>
                  <th className="pb-3 text-right font-medium">
                    {messages.opens}
                  </th>
                  <th className="pb-3 text-right font-medium">
                    {messages.bookings}
                  </th>
                  <th className="pb-3 text-right font-medium">
                    {messages.contacts}
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.sources.map((source) => (
                  <tr className="border-t border-border/70" key={source.source}>
                    <td className="py-3 font-medium">{source.source}</td>
                    <td className="py-3 text-right tabular-nums">
                      {number.format(source.sessions)}
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      {number.format(source.trackedLinkOpens)}
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      {number.format(source.bookingsCreated)}
                    </td>
                    <td className="py-3 text-right tabular-nums">
                      {number.format(source.contactClicks)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{messages.noSources}</p>
        )}
        {report.sourcesTruncated ? (
          <p className="text-xs text-muted-foreground">
            {locale.startsWith("ru")
              ? "Показаны 100 крупнейших источников."
              : "Showing the top 100 sources."}
          </p>
        ) : null}
      </Card>
    </div>
  );
}
