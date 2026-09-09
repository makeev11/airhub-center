import { messageText } from "@/shared/locale/messengerCopy";
export function getMessageThreadCopy(isRussian: boolean) {
  const m = (key: string, values?: Record<string, string | number>) =>
    messageText(key, values, isRussian ? "ru-RU" : "en-US");
  return {
    collapseThread: m("Collapse thread"),
    collapseReplies: m("Collapse replies"),
    emptyTitle: m("No replies in this branch yet"),
    emptyDescription: m("Reply in the thread to continue this branch."),
    newMessages: (count: number) => m("New messages: {count}", { count }),
    jumpToLatest: m("Jump to latest"),
    huddlePlaceholder: m("Message the huddle"),
    replyPlaceholder: (author: string) =>
      m("Reply in thread to {author}", { author }),
    back: m("Back to conversation"),
    title: m("Thread"),
  };
}
