import { messengerWorkflowRu } from "./messengerWorkflow.ru";
import { messengerStaticRu } from "./messengerStatic.ru";
import { messengerWorkflowPtBr } from "./messengerWorkflow.pt-BR";
import { messengerStaticPtBr } from "./messengerStatic.pt-BR";
import { airhopOperationalPtBr } from "./airhopOperational.pt-BR";
import { airhopShellPtBr } from "./airhopShell.pt-BR";
import { translateAirHopDynamicPtBr } from "./airhopDynamic.pt-BR";
import { useCallback } from "react";
import { resolveAirHopLocale, type AirHopLocale } from "./airhopLocale";
import { useAirHopLocale } from "./useAirHopLocale";

export const MESSENGER_RU: Record<string, string> = {
  ...messengerStaticRu,
  ...messengerWorkflowRu,
  agent: "агент",
  "Add {name}": "Добавить: {name}",
  "{status}. View activity.": "{status}. Показать активность.",
  "Channel type: {label}": "Тип канала: {label}",
  "Copied {label}": "Скопировано: {label}",
  "Copy {label}": "Скопировать: {label}",
  "{names} is not in this channel. Invite them, or send without inviting them.":
    "В этом канале нет: {names}. Пригласите участника или отправьте сообщение без приглашения.",
  "{names} are not in this channel. Invite them, or send without inviting them.":
    "В этом канале нет: {names}. Пригласите участников или отправьте сообщение без приглашения.",
  "{names} is typing...": "{names} печатает…",
  "{names} are typing...": "{names} печатают…",
  "{names}, and {count} others are typing...":
    "{names} и ещё {others} печатают…",
  "{name} is working": "{name} работает",
  "Agents working: {count}": "Работают агенты: {count}",
  "+{count} more": "ещё {count}",
  "1 channel": "1 канал",
  "Raw ACP activity": "Подробная активность ACP",
  Activity: "Активность",
  "{color} pen": "Перо: {color}",
  "View the full diff at the source repository.":
    "Полные изменения доступны в исходном репозитории.",
  "Agents must already be in a DM to be mentioned in its threads. Start a new conversation that includes the agent.":
    "Упоминать агента в ветках личной переписки можно, если он уже участвует в ней. Начните новую переписку с этим агентом.",
  "Checking conversation members. Try again in a moment.":
    "Проверяем участников переписки. Попробуйте через несколько секунд.",
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
  forum: "форум",
  channel: "канал",
  "Direct messages": "Личные сообщения",
  Forum: "Форум",
  Private: "Закрытый",
  Open: "Открытый",
};

export const MESSENGER_PT_BR: Record<string, string> = {
  ...messengerStaticPtBr,
  ...messengerWorkflowPtBr,
  ...airhopOperationalPtBr,
  ...airhopShellPtBr,
  agent: "agente",
  "Add {name}": "Adicionar {name}",
  "{status}. View activity.": "{status}. Ver atividade.",
  "Channel type: {label}": "Tipo de canal: {label}",
  "Copied {label}": "{label} copiado",
  "Copy {label}": "Copiar {label}",
  "{names} is not in this channel. Invite them, or send without inviting them.":
    "{names} não está neste canal. Convide essa pessoa ou envie sem convidar.",
  "{names} are not in this channel. Invite them, or send without inviting them.":
    "{names} não estão neste canal. Convide essas pessoas ou envie sem convidar.",
  "{names} is typing...": "{names} está digitando…",
  "{names} are typing...": "{names} estão digitando…",
  "{names}, and {count} others are typing...":
    "{names} e mais {others} estão digitando…",
  "{name} is working": "{name} está trabalhando",
  "Agents working: {count}": "Agentes trabalhando: {count}",
  "+{count} more": "mais {count}",
  "1 channel": "1 canal",
  "Raw ACP activity": "Atividade ACP bruta",
  Activity: "Atividade",
  "{color} pen": "Caneta {color}",
  "View the full diff at the source repository.":
    "Ver todas as alterações no repositório de origem.",
  "Agents must already be in a DM to be mentioned in its threads. Start a new conversation that includes the agent.":
    "O agente precisa participar da conversa direta para ser mencionado. Inicie uma nova conversa que inclua o agente.",
  "Checking conversation members. Try again in a moment.":
    "Verificando participantes da conversa. Tente novamente em instantes.",
  Cancel: "Cancelar",
  Save: "Salvar",
  Close: "Fechar",
  Retry: "Tentar novamente",
  "Loading…": "Carregando…",
  "Loading...": "Carregando…",
  You: "Você",
  you: "você",
  "Add agents": "Adicionar agentes de IA",
  "Add agent": "Adicionar agente",
  "Your agents": "Seus agentes",
  "Adding…": "Adicionando…",
  Add: "Adicionar",
  "Search agents": "Buscar agentes",
  "Choose the center’s registered agents. Existing identities and history are preserved.":
    "Escolha os agentes registrados do centro. As identidades e o histórico existentes serão preservados.",
  "No registered agents are available.":
    "Nenhum agente registrado está disponível.",
  "Connect the AirHop team in AI agent settings.":
    "Conecte a equipe AirHop nas configurações de agentes de IA.",
  "Could not load the center’s team.":
    "Não foi possível carregar a equipe do centro.",
  "Could not add the agent. Refresh and try again.":
    "Não foi possível adicionar o agente. Atualize e tente novamente.",
  "Already in this channel": "Já está neste canal",
  Hermes: "Hermes",
  "Parent Administrator": "Administrador de responsáveis",
  "Only active registered agents are shown. Global personas are not imported.":
    "Somente agentes registrados e ativos são exibidos. Personas globais não são importadas.",
  "Cannot remove yourself.": "Você não pode remover a si mesmo.",
  "The center owner cannot be removed.":
    "O proprietário do centro não pode ser removido.",
  "Only the owner can remove an administrator.":
    "Somente o proprietário pode remover um administrador.",
  "Wait for the current operation to finish.":
    "Aguarde a conclusão da operação atual.",
  "Could not verify employee identities. Refresh to try again.":
    "Não foi possível verificar as identidades dos funcionários. Atualize e tente novamente.",
  "Profile not completed": "Perfil não preenchido",
  forum: "fórum",
  channel: "canal",
  "Direct messages": "Conversas diretas",
  Forum: "Fórum",
  Private: "Privado",
  Open: "Aberto",
};

/** Translate interface copy only. Never pass customer content or identity names here. */
export function messageText(
  key: string,
  values: Record<string, string | number> = {},
  locale: AirHopLocale = resolveAirHopLocale(),
): string {
  const template =
    locale === "ru-RU"
      ? (MESSENGER_RU[key] ?? key)
      : locale === "pt-BR"
        ? (MESSENGER_PT_BR[key] ?? translateAirHopDynamicPtBr(key) ?? key)
        : key;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    String(values[name] ?? match),
  );
}

/** Localizes legacy Russian/English copy pairs while preserving non-text values. */
export function localePair<T>(
  russian: T,
  english: T,
  locale: AirHopLocale = resolveAirHopLocale(),
): T {
  if (locale === "ru-RU") return russian;
  if (locale === "pt-BR" && typeof english === "string") {
    return messageText(english, {}, locale) as T;
  }
  return english;
}

/** Localizes a small, plain copy object while leaving application data intact. */
export function localizeCopyTree<T>(
  value: T,
  locale: AirHopLocale = resolveAirHopLocale(),
): T {
  if (locale !== "pt-BR") return value;
  if (typeof value === "string") return messageText(value, {}, locale) as T;
  if (typeof value === "function") {
    return ((...args: unknown[]) =>
      localizeCopyTree(
        (value as (...functionArgs: unknown[]) => unknown)(...args),
        locale,
      )) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => localizeCopyTree(item, locale)) as T;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        localizeCopyTree(item, locale),
      ]),
    ) as T;
  }
  return value;
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
  if (locale === "pt-BR") {
    const ptBr = { agent: "agente", member: "participante", reply: "resposta" };
    return `${count} ${ptBr[noun]}${count === 1 ? "" : "s"}`;
  }
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
  if (resolveAirHopLocale() === "en-US" || resolveAirHopLocale() === "tr-TR")
    return raw || fallback;
  return messageText(fallback);
}

/** Typing feedback treats names as data and uses whole localized sentences. */
export function messengerTyping(
  names: string[],
  locale: AirHopLocale = resolveAirHopLocale(),
): string {
  if (names.length === 0) return "";
  if (names.length <= 3)
    return messageText(
      names.length === 1 ? "{names} is typing..." : "{names} are typing...",
      {
        names: new Intl.ListFormat(locale, {
          style: "long",
          type: "conjunction",
        }).format(names),
      },
      locale,
    );
  return messageText(
    "{names}, and {count} others are typing...",
    {
      names: names.slice(0, 2).join(", "),
      count: names.length - 2,
      others: messengerCount(names.length - 2, "member", locale),
    },
    locale,
  );
}
