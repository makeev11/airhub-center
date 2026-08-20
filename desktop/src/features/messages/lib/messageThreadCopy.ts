export function getMessageThreadCopy(isRussian: boolean) {
  return isRussian
    ? {
        collapseThread: "Свернуть обсуждение",
        collapseReplies: "Свернуть ответы",
        emptyTitle: "В этой ветке пока нет ответов",
        emptyDescription: "Ответьте в обсуждении, чтобы продолжить эту ветку.",
        newMessages: (count: number) => `Новых сообщений: ${count}`,
        jumpToLatest: "К последним сообщениям",
        huddlePlaceholder: "Сообщение в созвон",
        replyPlaceholder: (author: string) =>
          `Ответ в обсуждении для ${author}`,
        back: "Назад к переписке",
        title: "Обсуждение",
      }
    : {
        collapseThread: "Collapse thread",
        collapseReplies: "Collapse replies",
        emptyTitle: "No replies in this branch yet",
        emptyDescription: "Reply in the thread to continue this branch.",
        newMessages: (count: number) =>
          `${count} new message${count === 1 ? "" : "s"}`,
        jumpToLatest: "Jump to latest",
        huddlePlaceholder: "Message the huddle",
        replyPlaceholder: (author: string) => `Reply in thread to ${author}`,
        back: "Back to conversation",
        title: "Thread",
      };
}
