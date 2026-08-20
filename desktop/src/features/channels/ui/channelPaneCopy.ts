import { useAirHopLocale } from "@/features/activation/useAirHopLocale";

export function useChannelPaneCopy() {
  const isRussian = useAirHopLocale() === "ru-RU";
  return isRussian
    ? {
        surfaceLabel: "Сообщения и поле ввода канала",
        forumEmptyDescription: "Выберите обсуждение или личную переписку.",
        channelEmptyDescription:
          "Здесь появятся сообщения и ответы из этого канала.",
        forumEmptyTitle: "Выберите обсуждение",
        channelEmptyTitle: "Сообщений пока нет",
        noChannelTitle: "Канал не выбран",
        viewing: "Просмотр ",
        joining: "Присоединяемся…",
        join: "Присоединиться",
        channelFallback: "канал",
        timedOut: "Вам временно запретили писать в этом канале.",
        readOnly: "Этот канал доступен только для чтения.",
        archivedReadOnly: "Архивные каналы доступны только для чтения.",
        forumUnavailable: "Публикация в форуме пока недоступна.",
        messagePerson: (name: string) => `Сообщение для ${name}`,
        messageChannel: (name: string) => `Сообщение в #${name}`,
        selectChannel: "Выберите канал",
        emptyDescription: (forum: boolean) =>
          forum
            ? "Выберите обсуждение или личную переписку."
            : "Здесь появятся сообщения и ответы из этого канала.",
        emptyTitle: (kind?: string) =>
          kind === "forum"
            ? "Выберите обсуждение"
            : kind
              ? "Сообщений пока нет"
              : "Канал не выбран",
      }
    : {
        surfaceLabel: "Channel messages and composer",
        forumEmptyDescription:
          "Select a stream or direct message to load its history.",
        channelEmptyDescription:
          "Messages and replies will appear here once the channel has history.",
        forumEmptyTitle: "Select a discussion",
        channelEmptyTitle: "No messages yet",
        noChannelTitle: "No channel selected",
        viewing: "Viewing ",
        joining: "Joining...",
        join: "Join to participate",
        channelFallback: "channel",
        timedOut: "You're timed out by Center administrators.",
        readOnly: "This channel is read-only.",
        archivedReadOnly: "Archived channels are read-only.",
        forumUnavailable: "Forum posting is not available yet.",
        messagePerson: (name: string) => `Message ${name}`,
        messageChannel: (name: string) => `Message #${name}`,
        selectChannel: "Select a channel",
        emptyDescription: (forum: boolean) =>
          forum
            ? "Select a stream or direct message to load its history."
            : "Messages and replies will appear here once the channel has history.",
        emptyTitle: (kind?: string) =>
          kind === "forum"
            ? "Select a discussion"
            : kind
              ? "No messages yet"
              : "No channel selected",
      };
}
