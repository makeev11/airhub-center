import { canonicalChannelName } from "@/features/channels/lib/canonicalChannelName";
import type { Channel } from "@/shared/api/types";

export function normalizeBuzzChannelName(value: string): string {
  return canonicalChannelName(value).trim();
}

export function activeBuzzWorkChannels(
  channels: readonly Channel[],
): Channel[] {
  return channels.filter(
    (channel) =>
      channel.channelType === "stream" && channel.archivedAt === null,
  );
}

export function findBuzzWorkChannel(
  channels: readonly Channel[],
  value: string,
): Channel | null {
  const name = normalizeBuzzChannelName(value).toLocaleLowerCase();
  if (!name) return null;
  return (
    activeBuzzWorkChannels(channels).find(
      (channel) =>
        normalizeBuzzChannelName(channel.name).toLocaleLowerCase() === name,
    ) ?? null
  );
}

export function suggestBuzzWorkChannels(
  channels: readonly Channel[],
  value: string,
  limit = 3,
): Channel[] {
  const name = normalizeBuzzChannelName(value).toLocaleLowerCase();
  if (!name) return [];
  return activeBuzzWorkChannels(channels)
    .filter((channel) =>
      normalizeBuzzChannelName(channel.name).toLocaleLowerCase().includes(name),
    )
    .sort((left, right) => {
      const leftName = normalizeBuzzChannelName(left.name).toLocaleLowerCase();
      const rightName = normalizeBuzzChannelName(
        right.name,
      ).toLocaleLowerCase();
      const leftStarts = leftName.startsWith(name);
      const rightStarts = rightName.startsWith(name);
      if (leftStarts !== rightStarts) return leftStarts ? -1 : 1;
      return leftName.localeCompare(rightName);
    })
    .slice(0, limit);
}
