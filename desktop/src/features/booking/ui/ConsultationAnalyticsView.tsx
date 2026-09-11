import * as React from "react";
import { Link } from "@tanstack/react-router";
import { ArrowUpRight, Check, Clock, MessageCircle, X } from "lucide-react";
import type {
  ConsultationAnalytics,
  ConsultationQuestion,
  ConsultationStatus,
} from "../data/consultationAnalyticsSchema";
import { Button } from "@/shared/ui/button";
import { Card } from "@/shared/ui/card";
import { Progress } from "@/shared/ui/progress";
import { ConsultationLearningView } from "./ConsultationLearningView";

type Filter = "all" | "delivery" | ConsultationStatus;

/** Booking enquiries, delivered questions and actionable, scoped conversation links. */
export function ConsultationAnalyticsView({
  report,
  locale,
  periodStart,
  periodEnd,
}: {
  report?: ConsultationAnalytics;
  locale: string;
  periodStart: string;
  periodEnd: string;
}) {
  const ru = locale.startsWith("ru");
  const t = (a: string, b: string) => (ru ? a : b);
  const [detailsOpen, setDetailsOpen] = React.useState(false);
  const [filter, setFilter] = React.useState<Filter>("all");
  const [question, setQuestion] = React.useState<ConsultationQuestion | null>(
    null,
  );
  const questionLabels: Record<ConsultationQuestion, string> = {
    age: t("Возраст ребёнка", "Child’s age"),
    branch: t("Выбор филиала", "Location"),
    activity: t("Выбор занятия", "Activity"),
    time: t("Дата и время", "Date and time"),
    contact: t("Имя и контакты", "Names and contact details"),
    confirmation: t("Подтверждение записи", "Booking confirmation"),
    other: t("Другой вопрос", "Other question"),
  };
  const statuses: Record<ConsultationStatus, string> = {
    waiting: t("Ждём клиента", "Waiting for parent"),
    quiet: t("Нет ответа более 48 ч", "No reply for over 48h"),
    agent_waiting: t("Ответ за агентом", "Agent’s turn"),
    with_staff: t("У сотрудника", "With staff"),
    booked: t("Заявка создана", "Booking created"),
    declined: t("Отказ по словам клиента", "Declined, based on parent’s words"),
    cancelled: t("Черновик отменён", "Draft cancelled"),
    delivery_issue: t("Ошибка доставки", "Delivery failed"),
    delivery_pending: t("Сообщение доставляется", "Delivery pending"),
    ongoing: t("Консультация продолжается", "Consultation ongoing"),
  };
  const date = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T12:00:00Z`));
  const n = (value: number) => new Intl.NumberFormat(locale).format(value);
  const select = (
    next: Filter,
    nextQuestion: ConsultationQuestion | null = null,
  ) => {
    setDetailsOpen(true);
    setFilter(next);
    setQuestion(nextQuestion);
  };
  if (!report)
    return (
      <Card className="p-6 space-y-2" data-testid="consultations-unavailable">
        <h2 className="font-semibold">
          {t(
            "Данные консультаций недоступны",
            "Consultation data is unavailable",
          )}
        </h2>
        <p className="text-sm text-muted-foreground">
          {t(
            "Сервер не передал отчёт. Попробуйте обновить аналитику. Если учёт ещё не подключён, потребуется обновление сервера.",
            "The server did not return this report. Try refreshing analytics. A server update is needed if tracking is not connected yet.",
          )}
        </p>
      </Card>
    );
  const summary = report.summary;
  const items = report.items.filter(
    (item) =>
      (filter === "all" ||
        item.status === filter ||
        (filter === "delivery" &&
          ["delivery_pending", "delivery_issue"].includes(item.status))) &&
      (!question || item.question === question),
  );
  const cards: {
    label: string;
    value: number;
    filter: Filter;
    hint: string;
    icon: typeof MessageCircle;
    attention?: boolean;
  }[] = [
    {
      label: t("Начали запись", "Booking enquiries"),
      value: summary.started,
      filter: "all",
      hint: t(
        "Новые консультации за период",
        "Enquiries started in this period",
      ),
      icon: MessageCircle,
    },
    {
      label: t("Создали заявку", "Bookings created"),
      value: summary.booked,
      filter: "booked",
      hint: t("На момент обновления", "As of the latest refresh"),
      icon: Check,
    },
    {
      label: t("Ждём клиента", "Waiting for parent"),
      value: summary.waiting,
      filter: "waiting",
      hint: t("Прошло менее 48 часов", "Less than 48 hours"),
      icon: Clock,
    },
    {
      label: t("Долго нет ответа", "No reply for a while"),
      value: summary.quiet,
      filter: "quiet",
      hint: t(
        "Более 48 часов после вопроса",
        "Over 48 hours since the question",
      ),
      icon: Clock,
      attention: summary.quiet > 0,
    },
  ];
  return (
    <div className="space-y-5" data-testid="airhop-consultations">
      <div>
        <p className="text-sm font-medium">
          {date(periodStart)} — {date(periodEnd)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(
            "Консультации о новой записи, начатые за период. Результаты — на момент обновления.",
            "New booking enquiries started in this period. Outcomes are current as of refresh.",
          )}
        </p>
      </div>
      <ConsultationLearningView report={report} locale={locale} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {cards.map((card) => (
          <button
            key={card.filter}
            type="button"
            aria-pressed={filter === card.filter && !question}
            onClick={() => select(card.filter)}
            className={`rounded-xl border p-4 text-left transition-colors hover:bg-muted/50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring ${card.attention ? "border-amber-500/50 bg-amber-500/5" : "border-border bg-card"}`}
          >
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <card.icon className="size-4" aria-hidden="true" />
              {card.label}
            </span>
            <span className="mt-2 block text-2xl font-semibold tabular-nums">
              {n(card.value)}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {card.hint}
            </span>
          </button>
        ))}
      </div>
      <details
        open={detailsOpen || summary.started === 0}
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        className="space-y-4"
        data-testid="consultation-details"
      >
        <summary
          className={`cursor-pointer text-sm font-medium ${summary.started === 0 ? "hidden" : ""}`}
        >
          {t("Подробнее: этапы и диалоги", "Details: stages and conversations")}
        </summary>
        {summary.started > 0 && (
          <fieldset
            className="flex flex-wrap gap-2"
            aria-label={t(
              "Другие результаты консультаций",
              "Other consultation outcomes",
            )}
          >
            {(
              [
                ["agent_waiting", summary.agentWaiting],
                ["with_staff", summary.withStaff],
                ["declined", summary.declined],
                ["cancelled", summary.cancelled],
              ] as const
            )
              .filter(([, count]) => count > 0)
              .map(([status, count]) => (
                <Button
                  key={status}
                  size="sm"
                  variant="outline"
                  onClick={() => select(status)}
                >
                  {statuses[status]} · {n(count)}
                </Button>
              ))}
            {summary.delivery > 0 && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => select("delivery")}
              >
                {t("Доставка сообщений", "Message delivery")} ·{" "}
                {n(summary.delivery)}
              </Button>
            )}
          </fieldset>
        )}
        {!summary.started ? (
          <Card className="p-6 space-y-2">
            <h2 className="font-semibold">
              {t(
                "Здесь появится путь от вопроса до записи",
                "From the first question to a booking",
              )}
            </h2>
            <p className="text-sm text-muted-foreground">
              {t(
                "За этот период нет отслеживаемых консультаций о новой записи. Учёт начинается с размеченного вопроса агента или сохранения черновика. Старые диалоги не восстанавливаются автоматически.",
                "No tracked booking enquiries started in this period. Tracking begins with a tagged agent question or a saved draft. Past dialogues are not reconstructed automatically.",
              )}
            </p>
          </Card>
        ) : (
          <>
            <div className="grid gap-4 lg:grid-cols-2">
              <Card className="p-4 sm:p-5 space-y-4">
                <div>
                  <h2 className="font-semibold">
                    {t("Путь к записи", "Progress toward booking")}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(
                      "Сколько консультаций достигли каждого этапа",
                      "Enquiries that reached each stage",
                    )}
                  </p>
                </div>
                <div className="space-y-3">
                  {report.stages.map((stage) => {
                    const label = {
                      started: t("Начали консультацию", "Enquiry started"),
                      group: t("Выбрали занятие", "Activity selected"),
                      time: t("Выбрали дату и время", "Time selected"),
                      details: t(
                        "Собрали данные для записи",
                        "Booking details complete",
                      ),
                      confirmation: t(
                        "Отправили итог на подтверждение",
                        "Confirmation summary delivered",
                      ),
                      booked: t("Создали заявку", "Booking created"),
                    }[stage.key];
                    return (
                      <div key={stage.key}>
                        <div className="mb-1 flex justify-between gap-3 text-sm">
                          <span>{label}</span>
                          <span className="tabular-nums font-medium">
                            {n(stage.reached)}{" "}
                            <span className="text-muted-foreground font-normal">
                              / {n(summary.started)}
                            </span>
                          </span>
                        </div>
                        <Progress
                          aria-label={label}
                          value={(stage.reached / summary.started) * 100}
                        />
                      </div>
                    );
                  })}
                </div>
                <p className="text-xs text-muted-foreground">
                  {t(
                    "Данные могут быть известны заранее; порядок шагов свободный. Пропуск шага не означает потерю клиента.",
                    "Details may already be known and steps can happen in any order. A skipped step is not a lost customer.",
                  )}
                </p>
              </Card>
              <Card className="p-4 sm:p-5 space-y-4">
                <div>
                  <h2 className="font-semibold">
                    {t(
                      "После какого вопроса ждём",
                      "Which questions are waiting for an answer?",
                    )}
                  </h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(
                      "Нажмите на число, чтобы увидеть обращения",
                      "Select a count to see the conversations",
                    )}
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-xs text-muted-foreground">
                        <th className="pb-3 text-left font-medium">
                          {t("Вопрос", "Question")}
                        </th>
                        <th className="px-2 pb-3 text-right font-medium">
                          {t("Задали / ответили", "Asked / replied")}
                        </th>
                        <th className="px-2 pb-3 text-right font-medium">
                          {t("Ждём", "Waiting")}
                        </th>
                        <th className="px-2 pb-3 text-right font-medium">
                          {t("Более 48 ч", "Over 48h")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.questions.map((row) => (
                        <tr key={row.key} className="border-t border-border">
                          <td className="py-2 pr-2">
                            {questionLabels[row.key]}
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">
                            {n(row.asked)} / {n(row.answered)}
                          </td>
                          {(["waiting", "quiet"] as const).map((status) => (
                            <td key={status} className="text-right">
                              <button
                                type="button"
                                disabled={!row[status]}
                                aria-label={`${questionLabels[row.key]}: ${statuses[status]} — ${row[status]}`}
                                onClick={() => select(status, row.key)}
                                className={`min-h-9 min-w-9 rounded-md px-2 tabular-nums disabled:text-muted-foreground enabled:underline enabled:underline-offset-4 hover:enabled:bg-muted ${status === "quiet" && row.quiet ? "font-semibold text-amber-700 dark:text-amber-400" : ""}`}
                              >
                                {n(row[status])}
                              </button>
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
            <Card
              className="p-4 sm:p-5 space-y-4"
              data-testid="consultation-conversations"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold">
                  {t("Обращения", "Conversations")}
                  {question ? ` · ${questionLabels[question]}` : ""}
                </h2>
                {(filter !== "all" || question) && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => select("all")}
                  >
                    <X className="size-4" />
                    {t("Сбросить", "Reset")}
                  </Button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="text-sm">
                  <span className="sr-only">
                    {t("Статус консультации", "Consultation status")}
                  </span>
                  <select
                    value={filter}
                    onChange={(e) => setFilter(e.target.value as Filter)}
                    className="h-9 rounded-md border border-input bg-background px-3"
                  >
                    <option value="all">
                      {t("Все статусы", "All statuses")}
                    </option>
                    <option value="delivery">
                      {t("Доставка сообщений", "Message delivery")}
                    </option>
                    {Object.entries(statuses).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <span
                  role="status"
                  className="self-center text-sm text-muted-foreground"
                >
                  {t(
                    `Показано: ${n(items.length)}`,
                    `Showing: ${n(items.length)}`,
                  )}
                </span>
              </div>
              {report.itemsTruncated && (
                <p className="text-sm text-muted-foreground">
                  {t(
                    "В списке первые 200 консультаций, сначала требующие внимания. Итоги выше включают все. Сузьте период, чтобы найти остальные.",
                    "The first 200 enquiries are listed, prioritising those needing attention. Totals include all enquiries. Narrow the period to find the rest.",
                  )}
                </p>
              )}
              {!items.length ? (
                <p className="py-4 text-sm text-muted-foreground">
                  {t(
                    "По этому фильтру обращений нет.",
                    "No conversations match this filter.",
                  )}
                </p>
              ) : (
                <div className="divide-y divide-border">
                  {items.map((item) => (
                    <div
                      key={item.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="min-w-0">
                        <Link
                          className="inline-flex items-center gap-1 font-medium hover:underline"
                          to="/channels/$channelId"
                          params={{ channelId: item.channelId }}
                          search={{
                            ...(item.rootEventId
                              ? { thread: item.rootEventId }
                              : {}),
                            ...(item.questionEventId
                              ? { messageId: item.questionEventId }
                              : {}),
                          }}
                        >
                          {item.title}
                          <ArrowUpRight className="size-4 shrink-0" />
                        </Link>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {[item.branchName, item.connectionName]
                            .filter(Boolean)
                            .join(" · ") ||
                            t("Обращение центра", "Centre enquiry")}
                          {item.question
                            ? ` · ${questionLabels[item.question]}`
                            : ""}
                        </p>
                      </div>
                      <div className="text-right">
                        <p
                          className={`text-sm ${item.status === "quiet" ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground"}`}
                        >
                          {statuses[item.status]}
                        </p>
                        {item.waitingSince && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {t("Без ответа", "Waiting")}{" "}
                            {n(
                              Math.max(
                                0,
                                Math.floor(
                                  (Date.parse(report.generatedAt) -
                                    Date.parse(item.waitingSince)) /
                                    3600000,
                                ),
                              ),
                            )}{" "}
                            {t("ч", "h")}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          </>
        )}
      </details>
      <details className="text-sm text-muted-foreground">
        <summary className="cursor-pointer">
          {t("Как считается", "How this is measured")}
        </summary>
        <div className="mt-3 space-y-2 max-w-prose">
          <p>
            {t(
              "Видны только обращения из доступных вам каналов. Вопрос учитывается после доставки, ответ — после нового сообщения клиента. Ответ на вопрос ещё не означает, что нужные данные получены.",
              "Only conversations in channels you can access are included. Questions count after delivery, replies after a new parent message. A reply does not necessarily provide the requested information.",
            )}
          </p>
          <p>
            {t(
              "48 часов тишины — повод посмотреть диалог, а не доказательство отказа. Отказ размечает агент со ссылкой на слова клиента. Передача сотруднику и ошибки доставки учитываются отдельно.",
              "48 hours without a reply is a reason to review the conversation, not proof of refusal. The agent labels refusals using the parent’s words. Staff handoffs and delivery errors are separate.",
            )}
          </p>
          <p>
            {t(
              "Созданная заявка может ещё ожидать подтверждения сотрудника. Общие вопросы и обслуживание существующих записей не входят в эту воронку.",
              "A created booking may still require staff confirmation. General questions and support for existing bookings are outside this funnel.",
            )}
          </p>
          <p>
            {t(
              `Диалогов с агентом без отслеживаемой записи за период: ${n(report.untrackedConversations)}. Среди них могут быть старые диалоги и вопросы без намерения записаться.`,
              `Agent conversations without tracked booking enquiries in this period: ${n(report.untrackedConversations)}. These may be older dialogues or non-booking questions.`,
            )}
          </p>
        </div>
      </details>
    </div>
  );
}
