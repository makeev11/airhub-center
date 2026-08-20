import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import {
  getThreadReference,
  isBroadcastReply,
} from "@/features/messages/lib/threading";
import {
  getProjectInboxReference,
  isProjectInboxItem,
} from "@/features/home/lib/projectInbox";
import type { TimelineReaction } from "@/features/messages/types";
import type {
  Channel,
  FeedItem,
  FeedItemCategory,
  HomeFeedResponse,
  RelayEvent,
} from "@/shared/api/types";
import { resolveMentionProps } from "@/shared/lib/resolveMentionNames";
import { resolveActivationLocale } from "@/features/activation/i18n";

export type InboxFilter =
  | "all"
  | "project"
  | "mention"
  | "thread"
  | "needs_action"
  | "agent_activity"
  | "reminders"
  | "drafts";

export type InboxItem = {
  avatarUrl: string | null;
  /**
   * Stable conversation identity: the NIP-10 root for messages, or a
   * repository-scoped root for Buzz Git work. Does NOT change when a new reply
   * advances the representative latest event. Use this for lifecycle
   * continuity: scroll gating, draft keys, local-reply storage, and selection.
   */
  conversationId: string;
  id: string;
  item: FeedItem;
  categories: FeedItemCategory[];
  categoryLabel: string;
  channelLabel: string | null;
  fullTimestampLabel: string;
  groupItems: FeedItem[];
  isActionRequired: boolean;
  latestActivityAt: number;
  mentionNames: string[];
  mentionPubkeysByName?: Record<string, string>;
  preview: string;
  senderLabel: string;
  subject: string;
  timestampLabel: string;
  unreadCount: number;
};

export type InboxTypeLabel = {
  text: string;
  channelLabel: string | null;
};

export type InboxReply = {
  authorLabel: string;
  authorPubkey: string;
  isAgent?: boolean;
  ownerLabel?: string | null;
  ownerPubkey?: string | null;
  avatarUrl: string | null;
  content: string;
  createdAt: number;
  depth?: number;
  fullTimestampLabel: string;
  id: string;
  /** Raw event kind — input to the config-nudge trust gate. */
  kind?: number;
  parentId?: string | null;
  reactions?: TimelineReaction[];
  rootId?: string | null;
  /**
   * Raw event signer, not a relay-delegated display author (`authorPubkey`).
   * The config-nudge trust gate authenticates against this field because only
   * the signing agent may enable the card.
   */
  signerPubkey?: string;
  tags?: string[][];
  timeLabel?: string;
};

export type InboxContextMessage = InboxReply & {
  depth: number;
  isSelected: boolean;
  mentionNames: string[];
  mentionPubkeysByName?: Record<string, string>;
};

export type InboxGroup = {
  label: string;
  items: InboxItem[];
};

type InboxChannel = Pick<Channel, "channelType" | "id" | "name">;

function inboxLocale() {
  return resolveActivationLocale() === "ru-RU" ? "ru-RU" : "en-US";
}

function inboxDateFormatter(options: Intl.DateTimeFormatOptions) {
  return new Intl.DateTimeFormat(inboxLocale(), options);
}

function startOfDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate());
}

function diffInDays(from: Date, to: Date) {
  return Math.round(
    (startOfDay(from).getTime() - startOfDay(to).getTime()) / 86_400_000,
  );
}

function tagValue(item: FeedItem, name: string) {
  return item.tags.find((tag) => tag[0] === name)?.[1]?.trim() || null;
}

function projectRootItem(item: FeedItem, groupItems: readonly FeedItem[]) {
  return (
    groupItems.find(
      (candidate) => candidate.kind === 1618 || candidate.kind === 1621,
    ) ?? item
  );
}

function projectTypeLabel(item: FeedItem) {
  const russian = inboxLocale() === "ru-RU";
  if (item.kind === 1618) return russian ? "Запрос на слияние" : "Pull request";
  if (item.kind === 1621) return russian ? "Задача" : "Issue";
  return russian ? "Обновление проекта" : "Project update";
}

function feedHeadline(item: FeedItem, groupItems: readonly FeedItem[] = []) {
  const russian = inboxLocale() === "ru-RU";
  if (isProjectInboxItem(item)) {
    const root = projectRootItem(item, groupItems);
    return (
      (tagValue(root, "subject") ?? root.content.trim().split("\n")[0]) ||
      projectTypeLabel(root)
    );
  }

  switch (item.kind) {
    case 40007:
      return russian ? "Напоминание" : "Reminder";
    case 43001:
      return russian ? "Запрошена задача" : "Job requested";
    case 43002:
      return russian ? "Задача принята" : "Job accepted";
    case 43003:
      return russian ? "Обновление выполнения" : "Progress update";
    case 43004:
      return russian ? "Результат задачи" : "Job result";
    case 43005:
      return russian ? "Задача отменена" : "Job cancelled";
    case 43006:
      return russian ? "Ошибка задачи" : "Job failed";
    case 45001:
      return russian ? "Публикация" : "Forum post";
    case 45003:
      return russian ? "Ответ" : "Forum reply";
    case 46010:
      return russian ? "Запрошено подтверждение" : "Approval requested";
    default:
      if (item.category === "mention") {
        return russian ? "Упоминание" : "Mention";
      }

      if (item.category === "agent_activity") {
        return russian ? "Обновление агента" : "Agent update";
      }

      return russian ? "Обновление канала" : "Channel update";
  }
}

function feedPreview(item: FeedItem) {
  const russian = inboxLocale() === "ru-RU";
  const content = item.content.trim();
  if (content.length > 0) {
    return content;
  }

  if (item.kind === 46010) {
    return russian
      ? "Процесс ожидает подтверждения."
      : "A workflow is waiting for approval.";
  }

  if (item.kind === 40007) {
    return russian ? "Вас ждёт напоминание." : "A reminder is waiting for you.";
  }

  return russian
    ? "Дополнительных сведений нет."
    : "No additional details were attached to this event.";
}

function categoryLabelFor(category: FeedItemCategory) {
  const russian = inboxLocale() === "ru-RU";
  return category === "needs_action"
    ? russian
      ? "Нужны действия"
      : "Needs Action"
    : category === "mention"
      ? russian
        ? "Упоминание"
        : "Mention"
      : category === "agent_activity"
        ? russian
          ? "Обновление агента"
          : "Agent update"
        : russian
          ? "Действие"
          : "Activity";
}

export function isThreadActivityItem(item: FeedItem) {
  if (item.category !== "activity") {
    return false;
  }

  const thread = getThreadReference(item.tags);
  return thread.parentId !== null && !isBroadcastReply(item.tags);
}

function isThreadReplyItem(item: FeedItem) {
  const thread = getThreadReference(item.tags);
  return thread.parentId !== null && !isBroadcastReply(item.tags);
}

function uniqueItemsById(items: readonly FeedItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function isItemUnread(
  item: FeedItem,
  readAt: number | null,
  getMessageReadAt?: (messageId: string) => number | null,
) {
  const messageReadAt = getMessageReadAt?.(item.id) ?? null;
  return item.createdAt > Math.max(readAt ?? 0, messageReadAt ?? 0);
}

function activityHeadline(item: FeedItem) {
  return feedHeadline(item);
}

function resolveItemChannel(
  item: FeedItem,
  channelById: ReadonlyMap<string, InboxChannel>,
) {
  const channel = item.channelId ? channelById.get(item.channelId) : undefined;
  const name = item.channelName?.trim() || channel?.name.trim() || null;

  return {
    name,
    type: item.channelType ?? channel?.channelType,
  };
}

function resolveGroupChannel(
  primaryItem: FeedItem,
  groupItems: FeedItem[],
  channelById: ReadonlyMap<string, InboxChannel>,
) {
  for (const candidate of [primaryItem, ...groupItems]) {
    const channel = resolveItemChannel(candidate, channelById);
    if (channel.name || channel.type) {
      return channel;
    }
  }

  return resolveItemChannel(primaryItem, channelById);
}

export function getInboxTypeLabel(item: InboxItem): InboxTypeLabel {
  const russian = inboxLocale() === "ru-RU";
  const channelName = item.channelLabel;

  if (item.groupItems.some(isProjectInboxItem)) {
    const root = projectRootItem(item.item, item.groupItems);
    return {
      text: projectTypeLabel(root),
      channelLabel: null,
    };
  }

  if (item.item.channelType === "dm") {
    return {
      text: item.senderLabel
        ? russian
          ? `Личное сообщение от ${item.senderLabel}`
          : `DM from ${item.senderLabel}`
        : russian
          ? "Личное сообщение"
          : "DM",
      channelLabel: null,
    };
  }

  const primaryCategory = item.item.category;
  if (primaryCategory === "mention") {
    return {
      text: channelName
        ? russian
          ? "Упомянули в"
          : "Mentioned in"
        : russian
          ? "Упоминание"
          : "Mentioned",
      channelLabel: channelName,
    };
  }

  if (primaryCategory === "needs_action") {
    return {
      text: channelName
        ? russian
          ? "Нужны действия в"
          : "Needs action in"
        : russian
          ? "Нужны действия"
          : "Needs action",
      channelLabel: channelName,
    };
  }

  if (isThreadActivityItem(item.item)) {
    return {
      text: channelName
        ? russian
          ? "Обсуждение в"
          : "Thread in"
        : russian
          ? "Обсуждение"
          : "Thread",
      channelLabel: channelName,
    };
  }

  return {
    text: channelName
      ? `${activityHeadline(item.item)} in`
      : activityHeadline(item.item),
    channelLabel: channelName,
  };
}

export function formatInboxTypeLabel(item: InboxItem) {
  const label = getInboxTypeLabel(item);
  return label.channelLabel
    ? `${label.text} #${label.channelLabel}`
    : label.text;
}

function categoryPriority(category: FeedItemCategory) {
  switch (category) {
    case "needs_action":
      return 0;
    case "mention":
      return 1;
    case "agent_activity":
      return 2;
    case "activity":
      return 3;
  }
}

function getInboxThreadKey(
  item: FeedItem,
  channelById: ReadonlyMap<string, InboxChannel>,
) {
  const projectReference = getProjectInboxReference(item);
  if (projectReference) {
    return `project:${projectReference.repoAddress}:${projectReference.rootId}`;
  }

  const channelType = resolveItemChannel(item, channelById).type;
  return getInboxConversationId(
    item.tags,
    item.id,
    item.channelId,
    channelType,
    item.kind,
  );
}

function getStableConversationId(
  item: FeedItem,
  channelById: ReadonlyMap<string, InboxChannel>,
) {
  return getInboxThreadKey(item, channelById);
}

/**
 * Returns the stable conversation ID for any FeedItem or relay event. Buzz Git
 * roots include their repository coordinate; messages use the NIP-10 root,
 * parent-reply tag, then event id.
 * This is the same derivation used by `buildInboxItems` for `conversationId`.
 */
export function getInboxConversationId(
  tags: string[][],
  eventId: string,
  channelId?: string | null,
  channelType?: string,
  kind?: number,
): string {
  if (kind !== undefined) {
    const projectReference = getProjectInboxReference({
      id: eventId,
      kind,
      tags,
    });
    if (projectReference) {
      return `project:${projectReference.repoAddress}:${projectReference.rootId}`;
    }
  }

  if (channelType === "dm" && channelId) {
    return `dm:${channelId}`;
  }

  const thread = getThreadReference(tags);
  return thread.rootId ?? thread.parentId ?? eventId;
}

/** Returns the stable conversation identity for a complete Inbox feed item. */
export function getInboxItemConversationId(item: FeedItem) {
  return getInboxConversationId(
    item.tags,
    item.id,
    item.channelId,
    item.channelType,
    item.kind,
  );
}

/** Finds the Inbox row containing an event, including grouped events. */
export function findInboxItemByEventId(
  items: readonly InboxItem[],
  eventId: string,
): InboxItem | null {
  return (
    items.find((item) => item.id === eventId) ??
    items.find((item) =>
      item.groupItems.some((groupItem) => groupItem.id === eventId),
    ) ??
    null
  );
}

function formatInboxTimestamp(unixSeconds: number) {
  const date = new Date(unixSeconds * 1_000);
  const now = new Date();
  const dayDiff = diffInDays(now, date);

  if (dayDiff === 0) {
    return inboxDateFormatter({ hour: "numeric", minute: "2-digit" }).format(
      date,
    );
  }

  if (dayDiff === 1) {
    return inboxLocale() === "ru-RU" ? "Вчера" : "Yesterday";
  }

  if (now.getFullYear() === date.getFullYear()) {
    return inboxDateFormatter({ month: "short", day: "numeric" }).format(date);
  }

  return inboxDateFormatter({
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function formatInboxFullTimestamp(unixSeconds: number) {
  return inboxDateFormatter({
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(unixSeconds * 1_000));
}

export function relayEventFromFeedItem(item: FeedItem): RelayEvent {
  return {
    content: item.content,
    created_at: item.createdAt,
    id: item.id,
    kind: item.kind,
    pubkey: item.pubkey,
    sig: "",
    tags: item.tags,
  };
}

export function groupInboxItems(items: InboxItem[]): InboxGroup[] {
  const groups = new Map<string, InboxItem[]>();
  const now = new Date();

  for (const item of items) {
    const date = new Date(item.latestActivityAt * 1_000);
    const dayDiff = diffInDays(now, date);
    const label =
      dayDiff === 0
        ? inboxLocale() === "ru-RU"
          ? "Сегодня"
          : "Today"
        : dayDiff === 1
          ? inboxLocale() === "ru-RU"
            ? "Вчера"
            : "Yesterday"
          : dayDiff < 7
            ? inboxDateFormatter({ weekday: "long" }).format(date)
            : inboxDateFormatter({
                month: "short",
                day: "numeric",
                year: "numeric",
              }).format(date);

    const current = groups.get(label) ?? [];
    current.push(item);
    groups.set(label, current);
  }

  return [...groups.entries()].map(([label, groupedItems]) => ({
    label,
    items: groupedItems,
  }));
}

export function buildInboxItems({
  channels,
  currentPubkey,
  feed,
  getChannelReadAt,
  getMessageReadAt,
  getThreadReadAt,
  profiles,
}: {
  channels?: InboxChannel[];
  currentPubkey?: string;
  feed?: HomeFeedResponse;
  getChannelReadAt?: (channelId: string) => number | null;
  getMessageReadAt?: (messageId: string) => number | null;
  getThreadReadAt?: (
    rootId: string,
    channelId?: string | null,
  ) => number | null;
  profiles?: UserProfileLookup;
}): InboxItem[] {
  if (!feed) {
    return [];
  }

  const feedItems = [
    ...feed.feed.mentions.map((item) => ({
      ...item,
      category: "mention" as const,
    })),
    ...feed.feed.needsAction.map((item) => ({
      ...item,
      category: "needs_action" as const,
    })),
    ...feed.feed.activity.map((item) => ({
      ...item,
      category: "activity" as const,
    })),
    ...feed.feed.agentActivity.map((item) => ({
      ...item,
      category: "agent_activity" as const,
    })),
  ];
  const channelById = new Map(
    (channels ?? []).map((channel) => [channel.id, channel]),
  );

  const threadGroups = new Map<
    string,
    {
      items: FeedItem[];
      latestActivityAt: number;
      rootItem: FeedItem | null;
    }
  >();

  for (const item of feedItems) {
    const threadKey = getInboxThreadKey(item, channelById);
    const group = threadGroups.get(threadKey) ?? {
      items: [],
      latestActivityAt: 0,
      rootItem: null,
    };

    group.items.push(item);
    group.latestActivityAt = Math.max(group.latestActivityAt, item.createdAt);
    if (item.id === getStableConversationId(item, channelById)) {
      group.rootItem = item;
    }

    threadGroups.set(threadKey, group);
  }

  return [...threadGroups.entries()]
    .sort(
      ([, left], [, right]) => right.latestActivityAt - left.latestActivityAt,
    )
    .map(([, group]) => {
      const conversationId = getStableConversationId(
        group.items[0],
        channelById,
      );
      const latestItem = group.items.reduce((latest, current) =>
        current.createdAt > latest.createdAt ? current : latest,
      );
      const groupChannel = resolveGroupChannel(
        latestItem,
        group.items,
        channelById,
      );
      const groupChannelId = group.items.find(
        (candidate) => candidate.channelId,
      )?.channelId;
      const channelReadAt =
        groupChannel.type === "dm" && groupChannelId && getChannelReadAt
          ? getChannelReadAt(groupChannelId)
          : undefined;
      const uniqueGroupItems = uniqueItemsById(group.items);
      const threadReplyItems = uniqueGroupItems.filter(isThreadReplyItem);
      const threadReadAt =
        groupChannel.type !== "dm" &&
        threadReplyItems.length > 0 &&
        getThreadReadAt
          ? getThreadReadAt(conversationId, groupChannelId)
          : undefined;
      const unreadItems = (
        channelReadAt !== undefined
          ? uniqueGroupItems.filter((candidate) =>
              isItemUnread(candidate, channelReadAt),
            )
          : threadReplyItems.length > 0 && getMessageReadAt
            ? threadReplyItems.filter((candidate) =>
                isItemUnread(candidate, null, getMessageReadAt),
              )
            : threadReadAt !== undefined
              ? threadReplyItems.filter((candidate) =>
                  isItemUnread(candidate, threadReadAt),
                )
              : []
      ).sort((left, right) => left.createdAt - right.createdAt);
      const item = unreadItems[0] ?? latestItem;
      const categories = [
        ...new Set(group.items.map((groupItem) => groupItem.category)),
      ].sort((left, right) => categoryPriority(left) - categoryPriority(right));
      const senderLabel = resolveUserLabel({
        pubkey: item.pubkey,
        currentPubkey,
        profiles,
        preferResolvedSelfLabel: true,
      });
      const subject = feedHeadline(item, group.items);
      const preview = feedPreview(item);
      const { mentionNames, mentionPubkeysByName } = resolveMentionProps(
        item.tags,
        profiles,
      );
      const channelLabel = groupChannel.name;
      const displayItem: FeedItem = {
        ...item,
        channelName: channelLabel ?? item.channelName,
        channelType: item.channelType ?? groupChannel.type,
      };
      const categoryLabel = categoryLabelFor(categories[0] ?? item.category);

      return {
        avatarUrl: profiles?.[item.pubkey.toLowerCase()]?.avatarUrl ?? null,
        conversationId,
        id: item.id,
        item: displayItem,
        categories,
        categoryLabel,
        channelLabel,
        fullTimestampLabel: formatInboxFullTimestamp(item.createdAt),
        groupItems: group.items,
        isActionRequired: categories.includes("needs_action"),
        latestActivityAt: group.latestActivityAt,
        mentionNames: mentionNames ?? [],
        mentionPubkeysByName,
        preview,
        senderLabel,
        subject,
        timestampLabel: formatInboxTimestamp(group.latestActivityAt),
        unreadCount: unreadItems.length,
      };
    });
}
