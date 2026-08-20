import { isEphemeralChannel } from "@/features/channels/lib/ephemeralChannel";
import { resolveActivationLocale } from "@/features/activation/i18n";
import type { TimelineMessage } from "@/features/messages/types";
import type { Channel } from "@/shared/api/types";
import { KIND_SYSTEM_MESSAGE } from "@/shared/constants/kinds";

export function getChannelIntroKind(channel: Channel): string {
  const isRussian = resolveActivationLocale() === "ru-RU";
  const isPrivate = channel.visibility === "private";
  const isEphemeral = isEphemeralChannel(channel);

  if (isPrivate && isEphemeral) {
    return isRussian ? "закрытый временный канал" : "private ephemeral channel";
  }
  if (isPrivate) {
    return isRussian ? "закрытый канал" : "private channel";
  }
  if (isEphemeral) {
    return isRussian ? "временный канал" : "ephemeral channel";
  }
  return isRussian ? "канал" : "regular channel";
}

export function getChannelIntroDescription(channel: Channel): string | null {
  return (
    channel.topic?.trim() ||
    channel.purpose?.trim() ||
    channel.description?.trim() ||
    null
  );
}

export function isWelcomeSetupSystemMessage(message: TimelineMessage) {
  if (message.kind !== KIND_SYSTEM_MESSAGE) {
    return false;
  }

  try {
    const payload = JSON.parse(message.body) as { type?: string };
    return (
      payload.type === "channel_created" || payload.type === "member_joined"
    );
  } catch {
    return false;
  }
}

export function isChannelCreatedSystemMessage(message: TimelineMessage) {
  if (message.kind !== KIND_SYSTEM_MESSAGE) {
    return false;
  }

  try {
    return (
      (JSON.parse(message.body) as { type?: string }).type === "channel_created"
    );
  } catch {
    return false;
  }
}

export function mentionsKnownAgent(
  mentionPubkeys: string[],
  knownAgentPubkeys: ReadonlySet<string>,
) {
  return mentionPubkeys.some((pubkey) =>
    knownAgentPubkeys.has(pubkey.toLowerCase()),
  );
}
