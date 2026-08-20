import type { Channel } from "@/shared/api/types";
import { resolveActivationLocale } from "@/features/activation/i18n";

export function getChannelDescription(channel: Channel | null): string {
  const isRussian = resolveActivationLocale() === "ru-RU";
  if (!channel) {
    return isRussian
      ? "Подключитесь к центру, чтобы просматривать каналы и сообщения."
      : "Connect to the Center to browse channels and read messages.";
  }

  const prefixes = [
    channel.archivedAt ? (isRussian ? "Архивный канал." : "Archived.") : null,
    !channel.isMember
      ? isRussian
        ? "Только чтение, пока вы не присоединитесь к каналу."
        : "Read-only until you join this open channel."
      : null,
  ].filter((value) => value && value.trim().length > 0);

  // Show only the first non-empty field to avoid duplication when
  // topic, description, and purpose contain overlapping text.
  const detail = [channel.topic, channel.description, channel.purpose].find(
    (value) => value && value.trim().length > 0,
  );

  const parts = [...prefixes, detail ?? null].filter(Boolean);

  return parts.length > 0
    ? parts.join(" ")
    : isRussian
      ? "Описание и активность канала."
      : "Channel details and activity.";
}
