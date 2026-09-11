import * as React from "react";
import { Copy, Check, ArrowUpRight } from "lucide-react";
import { Link } from "@tanstack/react-router";
import type { CenterAnalyticsReport } from "../data/centerAnalyticsSchema";
import { analyticsShare, analyticsSourceLabel } from "../lib/centerAnalytics";
import { createBookingFormatters } from "../lib/bookingLocale";
import { Card } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { Progress } from "@/shared/ui/progress";

export type CenterAnalyticsSection =
  | "overview"
  | "sources"
  | "students"
  | "capacity"
  | "money";

function Metric({
  label,
  value,
  detail,
}: {
  label: string;
  value: React.ReactNode;
  detail: string;
}) {
  return (
    <Card className="min-w-0 space-y-2 p-4">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums break-words">{value}</p>
      <p className="text-xs text-muted-foreground">{detail}</p>
    </Card>
  );
}

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="min-w-0 space-y-4 p-4 sm:p-5">
      <div>
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{hint}</p>
      </div>
      {children}
    </Card>
  );
}

function DailyActivity({
  report,
  locale,
}: {
  report: CenterAnalyticsReport;
  locale: string;
}) {
  const ru = locale.startsWith("ru");
  const [metric, setMetric] = React.useState<"bookings" | "present">(
    "bookings",
  );
  const number = new Intl.NumberFormat(locale);
  const [selected, setSelected] = React.useState<string | null>(null);
  const dateLabel = (date: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year:
        report.periodStart.slice(0, 4) !== report.asOfDate.slice(0, 4)
          ? "numeric"
          : undefined,
      timeZone: "UTC",
    }).format(new Date(`${date}T12:00:00Z`));
  const grouped = new Map<
    string,
    { date: string; end: string; value: number }
  >();
  for (const day of report.days) {
    const key = report.days.length > 45 ? day.date.slice(0, 7) : day.date;
    const row = grouped.get(key) ?? { date: day.date, end: day.date, value: 0 };
    row.value += day[metric];
    row.end = day.date;
    grouped.set(key, row);
  }
  const points = [...grouped.values()];
  const maximum = Math.max(1, ...points.map((p) => p.value));
  const active = points.find((p) => p.date === selected) ?? points.at(-1);
  if (report.days.length === 1) {
    return (
      <p className="text-xs text-muted-foreground">
        {ru
          ? "Выбран один день. Для динамики переключитесь на 7 дней или более."
          : "One day selected. Choose 7 days or more to see activity over time."}
      </p>
    );
  }
  if (report.days.every((day) => day.bookings === 0 && day.present === 0)) {
    return (
      <p className="text-sm text-muted-foreground">
        {ru
          ? "За выбранный период нет зарегистрированных записей и посещений. Отсутствие отметок не доказывает отсутствие занятий."
          : "No bookings or attendance are recorded for this period. Missing marks do not prove no lessons took place."}
      </p>
    );
  }
  return (
    <Panel
      title={ru ? "Записи и посещения" : "Bookings and attendance"}
      hint={
        ru
          ? "Создание записей — по дате заявки. Посещения — по дате завершённого занятия; это разные события."
          : "Bookings by creation date; recorded attendance by completed lesson date. These are different events."
      }
    >
      <div className="flex flex-wrap gap-2">
        {(["bookings", "present"] as const).map((key) => (
          <Button
            key={key}
            size="sm"
            variant={metric === key ? "default" : "outline"}
            aria-pressed={metric === key}
            onClick={() => setMetric(key)}
          >
            {key === "bookings"
              ? ru
                ? "Записи"
                : "Bookings"
              : ru
                ? "Посещения"
                : "Attendance"}
          </Button>
        ))}
      </div>
      <fieldset
        className="flex h-32 items-end gap-1 border-b border-border"
        aria-label={ru ? "Динамика за период" : "Activity during period"}
      >
        {points.map((point) => (
          <button
            type="button"
            key={point.date}
            className="group flex h-full min-w-0 flex-1 items-end rounded-t focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            title={`${dateLabel(point.date)}${point.end !== point.date ? ` — ${dateLabel(point.end)}` : ""}: ${number.format(point.value)}`}
            aria-label={`${dateLabel(point.date)}${point.end !== point.date ? ` — ${dateLabel(point.end)}` : ""}: ${number.format(point.value)}`}
            onFocus={() => setSelected(point.date)}
            onMouseEnter={() => setSelected(point.date)}
            onClick={() => setSelected(point.date)}
          >
            <span
              className="block w-full rounded-t-sm bg-primary/80 group-hover:bg-primary"
              style={{
                height: `${(point.value / maximum) * 100}%`,
                minHeight: point.value ? "0.125rem" : 0,
              }}
            />
          </button>
        ))}
      </fieldset>
      <div className="flex justify-between gap-3 text-xs text-muted-foreground">
        <span>{dateLabel(report.periodStart)}</span>
        <span>
          {ru
            ? `Шкала: 0–${number.format(maximum)}`
            : `Scale: 0–${number.format(maximum)}`}
        </span>
        <span>{dateLabel(report.asOfDate)}</span>
      </div>
      <p className="text-sm tabular-nums" aria-live="polite">
        {active
          ? `${dateLabel(active.date)}${active.end !== active.date ? ` — ${dateLabel(active.end)}` : ""}: ${number.format(active.value)}`
          : "—"}
      </p>
      <details>
        <summary className="cursor-pointer text-sm text-muted-foreground">
          {ru ? "Точные значения по дням" : "Exact daily values"}
        </summary>
        <div className="mt-3 max-h-64 overflow-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr>
                <th>{ru ? "Дата" : "Date"}</th>
                <th>{ru ? "Записи" : "Bookings"}</th>
                <th>{ru ? "Посещения" : "Attendance"}</th>
              </tr>
            </thead>
            <tbody>
              {report.days.map((day) => (
                <tr key={day.date} className="border-t border-border">
                  <td className="py-2">{dateLabel(day.date)}</td>
                  <td>{number.format(day.bookings)}</td>
                  <td>{number.format(day.present)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </Panel>
  );
}

/** Native operational dashboard. Every section states its actual time/grain. */
export function CenterAnalyticsView({
  report,
  locale,
  section,
}: {
  report: CenterAnalyticsReport;
  locale: string;
  section: CenterAnalyticsSection;
}) {
  const ru = locale.startsWith("ru");
  const n = (value: number) => new Intl.NumberFormat(locale).format(value);
  const money = createBookingFormatters(locale).money;
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));
  const dateRange = (start: string, end: string) =>
    start === end ? date(start) : `${date(start)} — ${date(end)}`;
  const period = dateRange(report.periodStart, report.asOfDate);
  const nowHint = `${ru ? "На сегодня" : "Current as of"}: ${date(report.today)}`;
  const [copied, setCopied] = React.useState(false);
  const [copyError, setCopyError] = React.useState(false);
  const [sourceFilter, setSourceFilter] = React.useState("");
  const activeSourceFilter = report.sources.some(
    (row) => row.source === sourceFilter,
  )
    ? sourceFilter
    : "";
  const sources = report.sources.filter(
    (row) => !activeSourceFilter || row.source === activeSourceFilter,
  );
  const empty = (
    <p className="text-sm text-muted-foreground">
      {ru
        ? "За этот период записей пока нет."
        : "No records in this period yet."}
    </p>
  );
  const copyForAnalyst = async () => {
    try {
      await navigator.clipboard.writeText(
        `${ru ? "Разбери данные Center. Отдели факты от гипотез. Период зафиксирован в снимке; относительные даты при повторном чтении могут сдвинуться. Проверь свежесть через airhop_read:" : "Review Center data. Separate facts from hypotheses. The snapshot fixes the period; relative dates can shift on refresh. Verify freshness with airhop_read:"}\n${JSON.stringify({ resource: "center_analytics", days: report.days.length, yesterday: !report.isPartial })}\n${JSON.stringify(report)}`,
      );
      setCopied(true);
      setCopyError(false);
    } catch {
      setCopied(false);
      setCopyError(true);
    }
  };
  return (
    <div className="space-y-4" data-testid={`airhop-center-${section}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium">
            {section === "capacity"
              ? dateRange(report.today, report.capacity.throughDate)
              : period}
          </p>
          <p className="text-xs text-muted-foreground">
            {report.timeZone} ·{" "}
            {section === "capacity"
              ? ru
                ? "Предстоящие занятия · фильтр периода не применяется"
                : "Upcoming lessons · independent of period filter"
              : report.isPartial
                ? ru
                  ? "Сегодняшний день ещё не завершён"
                  : "Today is partial"
                : ru
                  ? "Завершённые календарные дни"
                  : "Complete calendar days"}
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void copyForAnalyst()}
        >
          {copied ? <Check /> : <Copy />}
          {copied
            ? ru
              ? "Скопировано"
              : "Copied"
            : ru
              ? "Для Аналитика"
              : "For Analyst"}
        </Button>
      </div>
      {copyError ? (
        <p role="alert" className="text-sm text-destructive">
          {ru
            ? "Не удалось скопировать отчёт. Попробуйте ещё раз."
            : "Could not copy the report. Try again."}
        </p>
      ) : null}
      {copied ? (
        <p role="status" className="text-xs text-muted-foreground">
          {ru
            ? "Вставьте отчёт в Welcome и обратитесь к Аналитику. Ничего не отправлено автоматически."
            : "Paste the report in Welcome and ask the Analyst. Nothing was sent automatically."}
        </p>
      ) : null}
      {section === "overview" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label={ru ? "Новые записи" : "New bookings"}
              value={n(report.cohort.bookings)}
              detail={
                ru
                  ? "Все заявки, включая разовые и отменённые"
                  : "All created bookings, including singles and cancellations"
              }
            />
            <Metric
              label={ru ? "Посещения" : "Attendance"}
              value={n(report.attendance.present)}
              detail={
                ru
                  ? "Отметки «пришёл» на завершённых занятиях"
                  : "Present marks on completed lessons"
              }
            />
            <Metric
              label={ru ? "Новые зачисления" : "New enrollments"}
              value={n(report.students.newEnrollments)}
              detail={
                ru
                  ? "Зачисления в группы, не уникальные дети"
                  : "Group enrollments, not unique children"
              }
            />
            <Metric
              label={ru ? "Постоянные ученики" : "Active students"}
              value={n(report.students.active)}
              detail={nowHint}
            />
          </div>
          <DailyActivity report={report} locale={locale} />
          <Panel
            title={
              ru
                ? "Что стало с заявками этого периода"
                : "Outcomes of this period’s bookings"
            }
            hint={
              ru
                ? "Результаты наблюдаем на момент отчёта, даже если занятие состоялось позже. Этапы не обязаны идти строго последовательно; одна заявка не равна одному ребёнку."
                : "Outcomes observed at report time, even when lessons occur later. Stages are not necessarily nested; a booking is not a unique child."
            }
          >
            <div className="grid gap-4 sm:grid-cols-3 xl:grid-cols-5">
              {[
                [ru ? "Созданы" : "Created", report.cohort.bookings],
                [
                  ru ? "Подтверждались" : "Confirmed at least once",
                  report.cohort.confirmed,
                ],
                [
                  ru ? "Пробное / разовое посещено" : "Trial / single attended",
                  report.cohort.attended,
                ],
                [
                  ru ? "Зачисления из пробного" : "Trial enrollments",
                  report.cohort.enrollments,
                ],
                [
                  ru ? "Есть полученная оплата" : "Positive net payments",
                  report.cohort.payingEnrollments,
                ],
              ].map(([label, value]) => (
                <div key={String(label)}>
                  <p className="text-xs text-muted-foreground">{label}</p>
                  <p className="mt-1 text-xl font-semibold tabular-nums">
                    {n(Number(value))}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {ru
                ? `Ожидают подтверждения: ${n(report.cohort.pending)} · Отменены: ${n(report.cohort.cancelled)}`
                : `Pending: ${n(report.cohort.pending)} · Cancelled: ${n(report.cohort.cancelled)}`}
            </p>
          </Panel>
          <div className="flex flex-wrap gap-3 text-sm">
            <Link
              to="/booking/requests"
              className="inline-flex items-center gap-1 underline underline-offset-4"
            >
              {ru ? "Открыть заявки" : "Open requests"}
              <ArrowUpRight className="size-4" />
            </Link>
            <Link
              to="/booking/clients"
              className="inline-flex items-center gap-1 underline underline-offset-4"
            >
              {ru ? "Открыть клиентов" : "Open clients"}
              <ArrowUpRight className="size-4" />
            </Link>
          </div>
        </>
      ) : null}
      {section === "sources" ? (
        <Panel
          title={ru ? "Источники и результат" : "Acquisition and outcomes"}
          hint={
            ru
              ? "Заявки выбранного периода и их дальнейшие результаты. Деньги — получено минус возвраты по связанным зачислениям до момента отчёта; это не денежный поток за выбранные даты."
              : "This period’s booking cohort and its subsequent outcomes. Money is net receipts on linked enrollments through report time, not cash flow for the selected dates."
          }
        >
          <label className="flex flex-wrap items-center gap-2 text-sm">
            {ru ? "Источник в таблице" : "Table source"}
            <select
              className="h-9 rounded-md border border-input bg-background px-3"
              value={activeSourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
            >
              <option value="">{ru ? "Все источники" : "All sources"}</option>
              {[...new Set(report.sources.map((s) => s.source))].map((s) => (
                <option key={s} value={s}>
                  {analyticsSourceLabel(s, locale)}
                </option>
              ))}
            </select>
          </label>
          {sources.length ? (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead>
                  <tr>
                    {[
                      ru ? "Источник / ссылка" : "Source / link",
                      ru ? "Записи" : "Bookings",
                      ru ? "Пришли" : "Attended",
                      ru ? "Зачисления" : "Enrollments",
                      ru ? "С оплатой" : "Paying",
                      ru ? "Получено, нетто" : "Net receipts",
                    ].map((title) => (
                      <th key={title} className="pb-3 pr-3 font-medium">
                        {title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sources.map((s) => (
                    <tr
                      key={`${s.source}:${s.trackingLinkId}`}
                      className="border-t border-border"
                    >
                      <td className="py-3 pr-3">
                        <p>{analyticsSourceLabel(s.source, locale)}</p>
                        {s.linkName ? (
                          <p className="text-xs text-muted-foreground">
                            {s.linkName}
                          </p>
                        ) : null}
                      </td>
                      <td>{n(s.bookings)}</td>
                      <td>{n(s.attended)}</td>
                      <td>{n(s.enrollments)}</td>
                      <td>{n(s.payingEnrollments)}</td>
                      <td>
                        {s.money.length
                          ? s.money.map((m) => (
                              <p key={m.currency}>
                                {money(m.netMinor, m.currency)}
                              </p>
                            ))
                          : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            empty
          )}
          <p className="text-xs text-muted-foreground">
            {ru
              ? `Без связи с браузерной аналитикой: ${n(report.coverage.unattributedBookings)} из ${n(report.cohort.bookings)} заявок. Канал заявки может быть известен, конкретная площадка — нет.`
              : `Without browser attribution: ${n(report.coverage.unattributedBookings)} of ${n(report.cohort.bookings)} bookings. A booking channel may be known without a specific acquisition origin.`}
          </p>
          {report.sourcesTruncated ? (
            <p className="text-sm">
              {ru
                ? "Показаны 100 крупнейших источников; итоги включают все."
                : "Top 100 sources shown; totals include all."}
            </p>
          ) : null}
        </Panel>
      ) : null}
      {section === "students" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric
              label={ru ? "Пришли" : "Present"}
              value={n(report.attendance.present)}
              detail={
                ru ? "Явные отметки посещений" : "Explicit attendance marks"
              }
            />
            <Metric
              label={ru ? "Не пришли" : "Absent"}
              value={n(report.attendance.absent)}
              detail={
                ru
                  ? "Только явные отметки, не пустые поля"
                  : "Explicit marks only, not missing values"
              }
            />
            <Metric
              label={ru ? "Разных детей пришло" : "Distinct children present"}
              value={n(report.attendance.children)}
              detail={period}
            />
            <Metric
              label={
                ru
                  ? "Вернулись из прошлого периода"
                  : "Returned from previous period"
              }
              value={analyticsShare(
                locale,
                report.students.returnedVisitors,
                report.students.previousVisitors,
              )}
              detail={`${n(report.students.returnedVisitors)} / ${n(report.students.previousVisitors)} · ${date(report.previousPeriodStart)} — ${date(report.previousPeriodEnd)}`}
            />
          </div>
          <Panel
            title={
              ru
                ? "Ученики и качество учёта"
                : "Students and recording coverage"
            }
            hint={
              ru
                ? "Повторное посещение не равно продлению договора. Отсутствие отметки не означает уход; текущий период может быть неполным."
                : "Repeat attendance is not a contract renewal. No attendance mark does not prove churn; the current period may be partial."
            }
          >
            <dl className="grid gap-4 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">
                  {ru ? "Постоянные ученики сейчас" : "Active students now"}
                </dt>
                <dd className="text-xl tabular-nums">
                  {n(report.students.active)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  {ru
                    ? "Повторные оплаты за период"
                    : "Repeat payments during period"}
                </dt>
                <dd className="text-xl tabular-nums">
                  {n(report.students.repeatPayingEnrollments)}
                </dd>
                <p className="text-xs text-muted-foreground">
                  {ru
                    ? "Зачисления с приходом за новый расчётный месяц после ранее оплаченного. Частичные оплаты включены, полный возврат исключён."
                    : "Enrollments receiving payment for a later billing month after an earlier paid month. Includes partial payments; excludes fully refunded balances."}
                </p>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  {ru
                    ? "Дети с приостановленным зачислением"
                    : "Children with paused enrollment"}
                </dt>
                <dd className="text-xl tabular-nums">
                  {n(report.students.paused)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  {ru
                    ? "Новые зачисления без связи с пробным"
                    : "New enrollments not linked to a trial"}
                </dt>
                <dd className="text-xl tabular-nums">
                  {n(report.students.unlinkedEnrollments)}
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">
                  {ru
                    ? "Завершённые занятия без единой отметки"
                    : "Completed lessons with no marks"}
                </dt>
                <dd className="text-xl tabular-nums">
                  {n(report.coverage.unmarkedLessons)}
                </dd>
              </div>
            </dl>
            <p className="text-xs text-muted-foreground">
              {ru
                ? "Ученик может иметь несколько зачислений и одновременно активную и приостановленную группу. Отсутствие связи с пробным включает прямое зачисление и старую историю без точной ссылки."
                : "A child may have multiple enrollments, including active and paused groups. Unlinked enrollments include direct enrollment and legacy history without an exact reference."}
            </p>
          </Panel>
          <Panel
            title={ru ? "Посещаемость по группам" : "Attendance by group"}
            hint={
              ru
                ? "Факты на завершённых, неотменённых занятиях за выбранный период."
                : "Explicit facts on completed, non-cancelled lessons during the selected period."
            }
          >
            {report.attendanceGroups.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[28rem] text-left text-sm">
                  <thead>
                    <tr>
                      <th>{ru ? "Группа / филиал" : "Group / branch"}</th>
                      <th>{ru ? "Пришли" : "Present"}</th>
                      <th>{ru ? "Не пришли" : "Absent"}</th>
                      <th>{ru ? "Разных детей" : "Distinct children"}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.attendanceGroups.map((g) => (
                      <tr
                        key={`${g.groupId}:${g.branchId}`}
                        className="border-t border-border"
                      >
                        <td className="py-3">
                          {g.groupName}
                          <p className="text-xs text-muted-foreground">
                            {g.branchName}
                          </p>
                        </td>
                        <td>{n(g.present)}</td>
                        <td>{n(g.absent)}</td>
                        <td>{n(g.children)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              empty
            )}
            {report.attendanceGroupsTruncated ? (
              <p className="text-xs">
                {ru
                  ? "Показаны первые 100 групп; общие итоги не обрезаны."
                  : "First 100 groups shown; totals are complete."}
              </p>
            ) : null}
          </Panel>
        </>
      ) : null}
      {section === "capacity" ? (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label={
                ru ? "Загрузка известных мест" : "Known-capacity occupancy"
              }
              value={analyticsShare(
                locale,
                report.capacity.occupied,
                report.capacity.places,
              )}
              detail={`${n(report.capacity.occupied)} / ${n(report.capacity.places)} · ${date(report.today)} — ${date(report.capacity.throughDate)}`}
            />
            <Metric
              label={ru ? "Ближайшие занятия" : "Upcoming lessons"}
              value={n(report.capacity.lessons)}
              detail={
                ru
                  ? "Оставшиеся занятия сегодня и следующие 6 дней"
                  : "Remaining lessons today and next 6 days"
              }
            />
            <Metric
              label={ru ? "Без указанной вместимости" : "Unknown capacity"}
              value={n(report.capacity.unknownCapacityLessons)}
              detail={
                ru
                  ? "Не включены в процент загрузки"
                  : "Excluded from occupancy percentage"
              }
            />
          </div>
          <Panel
            title={
              ru ? "Места на ближайшую неделю" : "Places in the coming week"
            }
            hint={
              ru
                ? "Текущие записи и выбранные слоты постоянных учеников. Один ребёнок занимает одно место на занятии; ожидающая подтверждения запись тоже резервирует место."
                : "Current bookings and selected permanent slots. Each child occupies one place per lesson, including pending bookings."
            }
          >
            {report.capacity.overbookedLessons ? (
              <p role="status" className="text-sm text-destructive">
                {ru
                  ? `Превышена вместимость на ${n(report.capacity.overbookedLessons)} занятиях.`
                  : `${n(report.capacity.overbookedLessons)} lessons exceed capacity.`}
              </p>
            ) : null}
            {report.capacity.items.length ? (
              <div className="space-y-4">
                {report.capacity.items.map((o) => (
                  <div
                    key={`${o.recurrenceRuleId}:${o.originalDate}`}
                    className="grid gap-2 border-b border-border pb-3 sm:grid-cols-[minmax(0,1fr)_10rem]"
                  >
                    <div>
                      <p className="text-sm font-medium">{o.groupName}</p>
                      <p className="text-xs text-muted-foreground">
                        {o.branchName} · {date(o.date)} ·{" "}
                        {o.startTime.slice(0, 5)}
                      </p>
                    </div>
                    <div>
                      <p className="mb-1 text-sm tabular-nums">
                        {n(o.occupied)} /{" "}
                        {o.capacity === null ? "—" : n(o.capacity)}
                      </p>
                      {o.capacity !== null ? (
                        <Progress
                          aria-label={`${o.groupName}: ${o.occupied} / ${o.capacity}`}
                          value={Math.min(100, (o.occupied * 100) / o.capacity)}
                        />
                      ) : (
                        <p className="text-xs text-muted-foreground">
                          {ru ? "Вместимость не задана" : "Capacity not set"}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              empty
            )}
            {report.capacity.itemsTruncated ? (
              <p className="text-xs">
                {ru
                  ? "Показаны ближайшие 100 занятий; итоги учитывают все."
                  : "Next 100 lessons shown; totals include all."}
              </p>
            ) : null}
          </Panel>
        </>
      ) : null}
      {section === "money" ? (
        <>
          <p className="text-sm text-muted-foreground">
            {ru
              ? "Денежные движения — по дате зарегистрированного прихода или возврата, не по расчётному месяцу. Валюты не складываются."
              : "Cash movements by recorded receipt/refund date, not billing month. Currencies are kept separate."}
          </p>
          {report.money.length
            ? report.money.map((m) => (
                <Panel key={m.currency} title={m.currency} hint={period}>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Metric
                      label={ru ? "Получено" : "Receipts"}
                      value={money(m.receiptsMinor, m.currency)}
                      detail={
                        ru ? "Зарегистрированные приходы" : "Recorded receipts"
                      }
                    />
                    <Metric
                      label={ru ? "Возвращено" : "Refunds"}
                      value={money(m.refundsMinor, m.currency)}
                      detail={
                        ru ? "Зарегистрированные возвраты" : "Recorded refunds"
                      }
                    />
                    <Metric
                      label={ru ? "Получено минус возвраты" : "Net cash"}
                      value={money(
                        m.receiptsMinor - m.refundsMinor,
                        m.currency,
                      )}
                      detail={
                        ru
                          ? "Может быть отрицательным; это не прибыль"
                          : "May be negative; this is not profit"
                      }
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">{nowHint}</p>
                  <div className="flex flex-wrap gap-6 text-sm">
                    <p>
                      {ru
                        ? "Открытый остаток, включая будущие оплаты"
                        : "Open balance, including future bills"}
                      :{" "}
                      <strong className="tabular-nums">
                        {money(m.outstandingMinor, m.currency)}
                      </strong>
                    </p>
                    <p>
                      {ru ? "Из них просрочено" : "Of which overdue"}:{" "}
                      <strong className="tabular-nums">
                        {money(m.overdueMinor, m.currency)}
                      </strong>
                    </p>
                  </div>
                </Panel>
              ))
            : empty}
        </>
      ) : null}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">
          {ru ? "Источники и свежесть данных" : "Sources and freshness"}
        </summary>
        <p className="mt-2">
          {ru ? "Снимок Center" : "Center snapshot"}:{" "}
          {new Intl.DateTimeFormat(locale, {
            dateStyle: "medium",
            timeStyle: "short",
            timeZone: report.timeZone,
          }).format(new Date(report.generatedAt))}
          .{" "}
          {ru
            ? "Источники: заявки, отметки посещаемости, зачисления, денежный журнал и серверная связь с аналитикой сайта. Числа в разных разделах имеют разные единицы и не складываются."
            : "Sources: bookings, attendance marks, enrollments, payment ledger and server-linked website attribution. Sections have different grains and are not additive."}
        </p>
        <p className="mt-2">
          {ru
            ? "Первая сохранённая отметка посещаемости"
            : "First retained attendance date"}
          :{" "}
          {report.coverage.firstAttendanceDate
            ? date(report.coverage.firstAttendanceDate)
            : "—"}
          .{" "}
          {ru
            ? "Нет отметок — не значит, что никто не приходил."
            : "No marks does not prove no attendance."}
        </p>
      </details>
    </div>
  );
}
