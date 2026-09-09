import { messengerWorkflowRu } from "./messengerWorkflow.ru";
import { messengerStaticRu } from "./messengerStatic.ru";
import { useCallback } from "react";
import { resolveAirHopLocale, type AirHopLocale } from "./airhopLocale";
import { useAirHopLocale } from "./useAirHopLocale";

export const MESSENGER_RU: Record<string, string> = {
  ...messengerStaticRu,
  ...messengerWorkflowRu,
  Cancel: "Отмена",
  Save: "Сохранить",
  Close: "Закрыть",
  Retry: "Повторить",
  "Loading…": "Загрузка…",
  "Loading...": "Загрузка…",
  You: "Вы",
  you: "вы",
  "Add agents": "Добавить AI-агентов",
  "Add agent": "Добавить агента",
  "Your agents": "Ваши агенты",
  "Adding…": "Добавляем…",
  Add: "Добавить",
  "Search agents": "Найти агента",
  "Choose the center’s registered agents. Existing identities and history are preserved.":
    "Выберите агентов этого центра. Их учётные записи и история сохранятся.",
  "No registered agents are available.": "Нет доступных агентов центра.",
  "Connect the AirHop team in AI agent settings.":
    "Подключите команду AirHop в настройках AI-агентов.",
  "Could not load the center’s team.": "Не удалось загрузить команду центра.",
  "Could not add the agent. Refresh and try again.":
    "Не удалось добавить агента. Обновите данные и попробуйте снова.",
  "Already in this channel": "Уже в этом канале",
  Hermes: "Гермес",
  "Parent Administrator": "Администратор для родителей",
  "Only active registered agents are shown. Global personas are not imported.":
    "Здесь только подключённые агенты этого центра. Общие шаблоны агентов не добавляются.",
  "Cannot remove yourself.": "Нельзя удалить себя из центра.",
  "The center owner cannot be removed.": "Владельца центра удалить нельзя.",
  "Only the owner can remove an administrator.":
    "Удалить администратора может только владелец.",
  "Wait for the current operation to finish.":
    "Дождитесь завершения текущего действия.",
  "Could not verify employee identities. Refresh to try again.":
    "Не удалось проверить список сотрудников. Обновите данные.",
  "Profile not completed": "Профиль не заполнен",
};

/** Translate interface copy only. Never pass customer content or identity names here. */
export function messageText(
  key: string,
  values: Record<string, string | number> = {},
  locale: AirHopLocale = resolveAirHopLocale(),
): string {
  const template = locale === "ru-RU" ? (MESSENGER_RU[key] ?? key) : key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    String(values[name] ?? match),
  );
}

/** Shared reactive copy source, including memoized messenger components. */
export function useMessengerCopy() {
  const locale = useAirHopLocale();
  return useCallback(
    (key: string, values?: Record<string, string | number>) =>
      messageText(key, values, locale),
    [locale],
  );
}

/** Count labels use the selected locale's plural categories, not English suffixes. */
export function messengerCount(
  count: number,
  noun: "agent" | "member" | "reply",
  locale: AirHopLocale = resolveAirHopLocale(),
): string {
  const ru = {
    agent: ["агент", "агента", "агентов"],
    member: ["участник", "участника", "участников"],
    reply: ["ответ", "ответа", "ответов"],
  };
  if (locale !== "ru-RU")
    return `${count} ${count === 1 ? noun : noun === "reply" ? "replies" : `${noun}s`}`;
  const category = new Intl.PluralRules(locale).select(count);
  return `${count} ${ru[noun][category === "one" ? 0 : category === "few" ? 1 : 2]}`;
}

/** Localize a UI error at render time; do not expose raw RPC/transport text in Russian. */
export function messageError(
  error: unknown,
  fallback = "Could not complete the action. Please try again.",
): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const key = Object.hasOwn(MESSENGER_RU, raw)
    ? raw
    : Object.keys(MESSENGER_RU).find((key) => MESSENGER_RU[key] === raw);
  if (key) return messageText(key);
  if (resolveAirHopLocale() !== "ru-RU") return raw || fallback;
  return messageText(fallback);
}
