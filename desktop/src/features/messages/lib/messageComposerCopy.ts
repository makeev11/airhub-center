import { useAirHopLocale } from "@/features/activation/useAirHopLocale";

export function useComposerCopy(
  channelName: string,
  editTarget: unknown,
  replyTarget: { author: string } | null | undefined,
  placeholder?: string,
): string {
  const isRussian = useAirHopLocale() === "ru-RU";
  if (!editTarget && placeholder) return placeholder;
  const edit = Boolean(editTarget);
  const replyAuthor = replyTarget?.author;
  if (edit) return isRussian ? "Измените сообщение" : "Edit your message";
  if (replyAuthor) {
    return isRussian
      ? `Ответ для ${replyAuthor} в #${channelName}`
      : `Reply to ${replyAuthor} in #${channelName}`;
  }
  return isRussian ? `Сообщение в #${channelName}` : `Message #${channelName}`;
}
