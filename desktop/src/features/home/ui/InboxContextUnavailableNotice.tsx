import { Info } from "lucide-react";
import { useAirHopLocale } from "@/features/activation/useAirHopLocale";
import type { InboxContextUnavailable } from "@/features/home/lib/loadInboxThreadContext";
import { localePair, messageText } from "@/shared/locale/messengerCopy";

/** Explain confirmed missing context without suggesting a network retry. */
export function InboxContextUnavailableNotice({
  reason,
}: {
  reason: NonNullable<InboxContextUnavailable>;
}) {
  const locale = useAirHopLocale();
  const title =
    locale === "ru-RU"
      ? {
          thread: "Обсуждение больше недоступно",
          message: "Сообщение больше недоступно",
          partial: "Часть обсуждения недоступна",
        }[reason]
      : messageText(
          {
            thread: "This discussion is no longer available",
            message: "This message is no longer available",
            partial: "Part of this discussion is unavailable",
          }[reason],
          {},
          locale,
        );
  return (
    <div
      className="mx-4 mb-3 flex items-start gap-2 rounded-xl border bg-muted/40 px-3 py-3 text-sm"
      data-testid="home-inbox-context-unavailable"
      role="status"
    >
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 space-y-1">
        <p className="font-medium">{title}</p>
        <p className="text-muted-foreground">
          {localePair(
            "Некоторые сообщения не найдены на сервере. Сохранённый текст оставлен для справки; ответ в это обсуждение недоступен.",
            "Some messages were not found on the server. Saved text is kept for reference; replies to this discussion are unavailable.",
          )}
        </p>
      </div>
    </div>
  );
}
