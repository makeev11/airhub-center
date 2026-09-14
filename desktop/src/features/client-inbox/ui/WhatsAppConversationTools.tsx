import { useState } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { messageText } from "@/shared/locale/messengerCopy";
import {
  renderWhatsAppTemplate,
  type ClientConversation,
  type ClientInboxService,
} from "../data/clientInboxService";

export function WhatsAppConversationTools({
  item,
  service,
  ru,
  onSent,
}: {
  item: ClientConversation;
  service: ClientInboxService;
  ru: boolean;
  onSent: () => Promise<unknown>;
}) {
  const t = (russian: string, english: string) =>
    ru ? russian : messageText(english);
  const [selected, setSelected] = useState("");
  const [parameters, setParameters] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const templates = item.whatsappTemplates ?? [];
  const template = templates.find(
    (value) => `${value.name}:${value.language}` === selected,
  );
  const slots = Array.from(
    { length: template?.parameterCount ?? 0 },
    (_, position) => ({
      id: `whatsapp-${item.id}-parameter-${position + 1}`,
      position,
    }),
  );
  const delivery = item.latestDelivery;
  const status = delivery?.providerStatus ?? delivery?.status;
  const names: Record<string, string> = {
    pending: t("В очереди", "Queued"),
    leased: t("Отправляется", "Sending"),
    accepted: t(
      "Принято Meta · доставка ожидается",
      "Accepted by Meta · awaiting delivery",
    ),
    sent: t("Отправлено · доставка ожидается", "Sent · awaiting delivery"),
    delivered: t("Доставлено", "Delivered"),
    read: t("Прочитано", "Read"),
    failed: t(
      "Не доставлено · требуется внимание сотрудника",
      "Not delivered · staff attention required",
    ),
    superseded: t("Отправка отменена", "Delivery cancelled"),
  };
  const code = delivery?.errorCode;
  const hint =
    code === "whatsapp_template_required"
      ? t(
          "Окно диалога закрыто. Отправьте одобренный сервисный шаблон или дождитесь нового сообщения клиента.",
          "The conversation window is closed. Send an approved utility template or wait for a new client message.",
        )
      : code === "whatsapp_send_uncertain" ||
          code === "whatsapp_delivery_unconfirmed"
        ? t(
            "Подтверждение от Meta не получено. Проверьте переписку перед новой отправкой.",
            "Meta confirmation is missing. Check the conversation before sending again.",
          )
        : code === "whatsapp_template_changed"
          ? t(
              "Шаблон изменился или больше не одобрен. Обновите список и проверьте текст.",
              "The template changed or is no longer approved. Refresh and review the text.",
            )
          : null;
  const valid =
    template &&
    parameters.length === template.parameterCount &&
    parameters.every(
      (v) => v.trim() && v.length <= 500 && !/[\n\r\t{}]/.test(v),
    );
  return (
    <div
      className="mt-3 space-y-2 text-sm"
      data-testid="whatsapp-conversation-tools"
    >
      {status && (
        <p
          className={
            delivery?.status === "failed"
              ? "text-destructive"
              : "text-muted-foreground"
          }
        >
          {t("Последнее сообщение: ", "Latest message: ")}
          {names[status] ?? status}
        </p>
      )}
      {hint && <p>{hint}</p>}
      <details>
        <summary className="cursor-pointer font-medium">
          {t("Сервисное сообщение WhatsApp", "WhatsApp utility message")}
        </summary>
        <div className="mt-3 space-y-3">
          <p className="text-muted-foreground">
            {t(
              "Одобренные Meta текстовые шаблоны. Проверьте получателя и каждое значение перед отправкой. Это отдельное сообщение; прежний текст автоматически не пересылается.",
              "Meta-approved text templates. Check the recipient and every value before sending. This is a separate message; previous text is not resent automatically.",
            )}
          </p>
          {templates.length === 0 ? (
            <p>
              {t(
                "Подходящих шаблонов нет. Создайте текстовый шаблон категории Utility в WhatsApp Manager и дождитесь одобрения и синхронизации (до 5 минут). Поддерживаются текстовый заголовок, основной текст с параметрами и подпись.",
                "No supported templates. Create a Utility text template in WhatsApp Manager, wait for approval and synchronization (up to 5 minutes). Text headers, body parameters and footers are supported.",
              )}
            </p>
          ) : (
            <>
              <label className="block">
                {t("Шаблон и язык", "Template and language")}
                <select
                  className="mt-1 h-9 w-full rounded-md border bg-background px-3"
                  value={selected}
                  disabled={pending}
                  onChange={(e) => {
                    const next = templates.find(
                      (v) => `${v.name}:${v.language}` === e.target.value,
                    );
                    setSelected(e.target.value);
                    setParameters(Array(next?.parameterCount ?? 0).fill(""));
                    setError(null);
                    setSent(false);
                  }}
                >
                  <option value="">
                    {t("Выберите шаблон", "Choose a template")}
                  </option>
                  {templates.map((v) => (
                    <option
                      key={`${v.name}:${v.language}`}
                      value={`${v.name}:${v.language}`}
                    >
                      {v.name} · {v.language}
                    </option>
                  ))}
                </select>
              </label>
              {template && (
                <>
                  {slots.map(({ id, position: index }) => (
                    <label className="block" key={id} htmlFor={id}>
                      {t("Значение", "Value")} {index + 1}
                      <Input
                        id={id}
                        value={parameters[index]}
                        maxLength={500}
                        disabled={pending}
                        onChange={(e) =>
                          setParameters((current) =>
                            current.map((v, i) =>
                              i === index ? e.target.value : v,
                            ),
                          )
                        }
                      />
                    </label>
                  ))}
                  <p className="font-medium">
                    {t("Получатель: ", "Recipient: ")}
                    {item.title}
                  </p>
                  <pre className="whitespace-pre-wrap rounded-md bg-muted p-3 font-sans">
                    {renderWhatsAppTemplate(template, parameters)}
                  </pre>
                  <Button
                    size="sm"
                    disabled={
                      !valid ||
                      pending ||
                      sent ||
                      item.connectionStatus !== "active"
                    }
                    onClick={async () => {
                      setPending(true);
                      setError(null);
                      try {
                        await service.sendWhatsAppTemplate(
                          item,
                          template,
                          parameters,
                        );
                        setSent(true);
                        await onSent();
                      } catch (e) {
                        setError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setPending(false);
                      }
                    }}
                  >
                    {pending
                      ? t("Отправляем…", "Sending…")
                      : sent
                        ? t("В очереди отправки", "Queued for delivery")
                        : t(
                            "Отправить проверенный текст",
                            "Send reviewed text",
                          )}
                  </Button>
                </>
              )}
            </>
          )}
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
