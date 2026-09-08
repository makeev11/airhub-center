import type { StaffSiteAnalyticsReport } from "@/features/booking/data/staffSiteAnalyticsService";
import { Card } from "@/shared/ui/card";

/** Traffic coverage and simple page/contact breakdowns from the server report. */
export function SiteAnalyticsDetails({
  locale,
  report,
}: {
  locale: string;
  report: StaffSiteAnalyticsReport;
}) {
  const ru = locale.startsWith("ru");
  const number = new Intl.NumberFormat(locale);
  const instant = (value: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: report.timeZone,
    }).format(new Date(value));
  const targets: Record<string, string> = ru
    ? {
        phone: "Телефон",
        email: "Почта",
        telegram: "Telegram",
        whatsapp: "WhatsApp",
        max: "MAX",
        other: "Другие",
      }
    : {
        phone: "Phone",
        email: "Email",
        telegram: "Telegram",
        whatsapp: "WhatsApp",
        max: "MAX",
        other: "Other",
      };
  const counts = [
    [ru ? "Просмотры страниц" : "Page views", report.totals.pageViews],
    [
      ru ? "Сессии с просмотром" : "Sessions with a view",
      report.siteFunnel.viewedSessions,
    ],
    [
      ru ? "Из них открыли запись" : "Of these, opened booking",
      report.siteFunnel.bookingSessions,
    ],
    [
      ru ? "Из них нажали контакт" : "Of these, clicked contact",
      report.siteFunnel.contactSessions,
    ],
    [
      ru ? "Из них создали запись" : "Of these, booked",
      report.siteFunnel.bookedSessions,
    ],
  ] as const;
  return (
    <>
      <Card className="space-y-2 p-4 sm:p-5">
        <p className="text-sm">
          {report.lastEventAt
            ? `${ru ? "Последнее событие" : "Latest event"}: ${instant(report.lastEventAt)}`
            : ru
              ? "События пока не поступали. Пройдите по сайту и обновите отчёт, чтобы проверить подключение."
              : "No events received yet. Visit the site and refresh this report to check collection."}
        </p>
        <p className="text-xs text-muted-foreground">
          {report.firstEventAt
            ? `${ru ? "Доступная история с" : "Available history since"} ${instant(report.firstEventAt)}. `
            : ""}
          {ru
            ? "История хранится 13 месяцев. Отсутствие событий само по себе не означает отсутствие посетителей."
            : "History is retained for 13 months. No events does not necessarily mean no visitors."}
        </p>
      </Card>
      <Card className="space-y-3 p-4 sm:p-5">
        <h2 className="text-base font-semibold">
          {ru ? "Путь с сайта к действию" : "From visit to action"}
        </h2>
        <dl className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          {counts.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="mt-1 text-xl font-semibold tabular-nums">
                {number.format(value)}
              </dd>
            </div>
          ))}
        </dl>
      </Card>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="space-y-3 p-4 sm:p-5">
          <h2 className="text-base font-semibold">
            {ru ? "Страницы" : "Pages"}
          </h2>
          <div className="max-h-80 overflow-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr>
                  <th>{ru ? "Путь" : "Path"}</th>
                  <th className="text-right">{ru ? "Просмотры" : "Views"}</th>
                  <th className="text-right">
                    {ru ? "Контакты: клики" : "Contact clicks"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {report.pages.map((page) => (
                  <tr key={page.path} className="border-t border-border/70">
                    <td className="max-w-64 break-words py-2">{page.path}</td>
                    <td className="text-right tabular-nums">
                      {number.format(page.views)}
                    </td>
                    <td className="text-right tabular-nums">
                      {number.format(page.contactClicks)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {report.pagesTruncated ? (
            <p className="text-xs text-muted-foreground">
              {ru
                ? "Показаны 100 самых просматриваемых страниц."
                : "Showing the 100 most viewed pages."}
            </p>
          ) : null}
        </Card>
        <Card className="space-y-3 p-4 sm:p-5">
          <h2 className="text-base font-semibold">
            {ru ? "Куда нажимают для связи" : "Contact destinations"}
          </h2>
          <dl className="space-y-3">
            {report.contacts.map((contact) => (
              <div
                key={contact.target}
                className="flex justify-between gap-3 text-sm"
              >
                <dt>{targets[contact.target]}</dt>
                <dd className="tabular-nums">
                  {number.format(contact.clicks)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted-foreground">
            {ru
              ? "Клик показывает намерение связаться, но не подтверждает звонок или переписку."
              : "A click indicates intent, not a confirmed call or conversation."}
          </p>
        </Card>
      </div>
    </>
  );
}
