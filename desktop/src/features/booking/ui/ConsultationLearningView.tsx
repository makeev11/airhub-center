import type { ConsultationAnalytics } from "../data/consultationAnalyticsSchema";
import { Card } from "@/shared/ui/card";

/** Owner-facing outcome with explicit measurement maturity and version evidence. */
export function ConsultationLearningView({
  report,
  locale,
}: {
  report: ConsultationAnalytics;
  locale: string;
}) {
  const ru = locale.startsWith("ru");
  const t = (a: string, b: string) => (ru ? a : b);
  const learning = report.learning;
  const n = (value: number) => new Intl.NumberFormat(locale).format(value);
  const rate = (booked: number, eligible: number) =>
    new Intl.NumberFormat(locale, {
      style: "percent",
      maximumFractionDigits: 1,
    }).format(booked / eligible);
  const bottleneck = [...report.questions].sort((a, b) => b.quiet - a.quiet)[0];
  const labels = {
    age: t("возраст ребёнка", "child’s age"),
    branch: t("выбор филиала", "location"),
    activity: t("выбор занятия", "activity"),
    time: t("дату и время", "date and time"),
    contact: t("имя и контакты", "names and contact details"),
    confirmation: t("подтверждение записи", "booking confirmation"),
    other: t("другой вопрос", "another question"),
  };
  const dated = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      day: "numeric",
      month: "short",
      timeZone: "UTC",
    }).format(new Date(value));
  return (
    <Card className="p-5 space-y-4" data-testid="consultation-learning">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-semibold">
            {t("Результат работы Гермеса", "Hermes outcomes")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {t(
              "Сколько консультаций привели к заявке за семь дней",
              "Enquiries that created a booking within seven days",
            )}
          </p>
        </div>
        <div className="text-right">
          <p className="text-3xl font-semibold tabular-nums">
            {learning?.eligible
              ? rate(learning.booked, learning.eligible)
              : "—"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {learning?.eligible
              ? t(
                  `${n(learning.booked)} из ${n(learning.eligible)} консультаций`,
                  `${n(learning.booked)} of ${n(learning.eligible)} enquiries`,
                )
              : t("Ждём результаты", "Waiting for outcomes")}
          </p>
        </div>
      </div>
      <p className="text-sm">
        {!learning
          ? t(
              "Сравнение версий пока недоступно: сервер должен начать сохранять историю конфигураций.",
              "Version comparison is not available yet. The server must start recording configurations.",
            )
          : learning.pending > 0
            ? t(
                `Ещё наблюдаем: ${n(learning.pending)}. С начала каждой консультации должно пройти семь дней.`,
                `${n(learning.pending)} enquiries are still being observed. Each needs seven days from its start.`,
              )
            : t(
                "В расчёт входят только консультации, с начала которых прошло семь дней.",
                "Only enquiries that started at least seven days ago enter this rate.",
              )}
      </p>
      {learning && learning.eligible === 0 && learning.pending > 0 && (
        <p className="text-xs text-muted-foreground">
          {t(
            "Выберите более длинный период, чтобы увидеть завершённые семидневные наблюдения.",
            "Choose a longer period to include completed seven-day observations.",
          )}
        </p>
      )}
      {bottleneck?.quiet > 0 && (
        <p className="text-sm text-muted-foreground">
          {t(
            `Чаще всего пауза после вопроса про ${labels[bottleneck.key]}: ${n(bottleneck.quiet)} без ответа более 48 часов. Аналитику стоит проверить этот этап.`,
            `The most unanswered questions concern ${labels[bottleneck.key]}: ${n(bottleneck.quiet)} enquiries have been quiet for over 48 hours. The Analyst should investigate this step.`,
          )}
        </p>
      )}
      {learning && (
        <details className="text-sm" data-testid="consultation-versions">
          <summary className="cursor-pointer font-medium">
            {t("Как меняются результаты", "How outcomes change")}
          </summary>
          <div className="mt-3 space-y-3">
            <p className="text-muted-foreground">
              {t(
                "Версии расположены по последнему обращению за выбранный период. Разница может зависеть от источника обращений и филиала. Она сама по себе не доказывает пользу изменения скрипта.",
                "Versions are ordered by their latest enquiry in this period. Differences may reflect traffic sources and locations; they do not establish that a script change helped.",
              )}
            </p>
            {learning.versions.length === 0 && (
              <p>
                {t(
                  "Пока нет консультаций с известной версией от начала до конца.",
                  "No enquiries have a known configuration throughout the observation window yet.",
                )}
              </p>
            )}
            {learning.versions.map((version) => {
              const persona = version.configuration.personaRevision;
              const deployment = version.configuration.deploymentVersion;
              return (
                <div
                  key={JSON.stringify(version.configuration)}
                  className="rounded-lg border p-3 space-y-2"
                >
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium break-all">
                      {t("Версия", "Version")}{" "}
                      {typeof deployment === "number" ? deployment : "—"}
                      {typeof persona === "string" && ` · ${persona}`}
                    </span>
                    <span className="font-semibold tabular-nums">
                      {version.eligible
                        ? rate(version.booked, version.eligible)
                        : "—"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {dated(version.firstStartedAt)} –{" "}
                    {dated(version.lastStartedAt)} ·{" "}
                    {t(
                      `${n(version.booked)} заявок из ${n(version.eligible)} наблюдённых консультаций; ещё ${n(version.pending)} в работе`,
                      `${n(version.booked)} bookings from ${n(version.eligible)} observed enquiries; ${n(version.pending)} still maturing`,
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      `Передано сотруднику: ${n(version.handedOff)} · Отказов: ${n(version.declined)} · Черновиков отменено: ${n(version.draftCancelled)}`,
                      `Handed off: ${n(version.handedOff)} · Declined: ${n(version.declined)} · Drafts cancelled: ${n(version.draftCancelled)}`,
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(
                      `Из созданных заявок сейчас отменено: ${n(version.bookingCancelledNow)}, отклонено: ${n(version.bookingRejectedNow)}.`,
                      `Of the bookings created, currently cancelled: ${n(version.bookingCancelledNow)}, rejected: ${n(version.bookingRejectedNow)}.`,
                    )}
                  </p>
                </div>
              );
            })}
            {(learning.mixed > 0 || learning.unattributed > 0) && (
              <p className="text-xs text-muted-foreground">
                {t(
                  `Исключены из сравнения версий: ${n(learning.mixed)} со сменой конфигурации, ${n(learning.unattributed)} без полной истории. В общем результате они учитываются.`,
                  `Excluded from version comparisons: ${n(learning.mixed)} with configuration changes, ${n(learning.unattributed)} without full history. They still count in the overall outcome.`,
                )}
              </p>
            )}
            {learning.versionsTruncated && (
              <p>
                {t(
                  "Показаны последние 20 версий за период.",
                  "Showing the latest 20 versions in this period.",
                )}
              </p>
            )}
          </div>
        </details>
      )}
    </Card>
  );
}
