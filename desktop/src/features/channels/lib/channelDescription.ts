import { messageText } from "@/shared/locale/messengerCopy";
import type { Channel } from "@/shared/api/types";

export function getChannelDescription(channel: Channel | null): string {
  if (!channel) {
    return messageText(
      "Connect to the Center to browse channels and read messages.",
    );
  }

  const prefixes = [
    channel.archivedAt ? messageText("Archived.") : null,
    !channel.isMember
      ? messageText("Read-only until you join this open channel.")
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
    : messageText("Channel details and activity.");
}
