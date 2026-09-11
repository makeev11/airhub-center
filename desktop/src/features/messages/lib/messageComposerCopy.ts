import { useMessengerCopy } from "@/shared/locale/messengerCopy";
export function useComposerCopy(
  channelName: string,
  editTarget: unknown,
  replyTarget: { author: string } | null | undefined,
  placeholder?: string,
): string {
  const m = useMessengerCopy();
  if (!editTarget && placeholder) return placeholder;
  if (editTarget) return m("Edit your message");
  if (replyTarget?.author)
    return m("Reply to {author} in #{name}", {
      author: replyTarget.author,
      name: channelName,
    });
  return m("Message #{name}", { name: channelName });
}
