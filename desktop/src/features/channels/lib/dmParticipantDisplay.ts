import { messageText } from "@/shared/locale/messengerCopy";
import type { AirHopLocale } from "@/shared/locale/airhopLocale";
import {
  resolveUserLabel,
  type UserProfileLookup,
} from "@/features/profile/lib/identity";
import type { Channel } from "@/shared/api/types";
import { normalizePubkey } from "@/shared/lib/pubkey";

export const DM_PARTICIPANT_PREVIEW_LIMIT = 3;

export type DmParticipantDisplay = {
  displayName: string;
};

export type DirectMessageIntroParticipant = {
  avatarUrl: string | null;
  displayName: string;
  pubkey: string;
};

export type DirectMessageIntro = {
  isSelf: boolean;
  displayName: string;
  participants: DirectMessageIntroParticipant[];
};

/** Whether this is a nonempty direct conversation containing only yourself. */
export function isSelfDirectMessage(
  channel: Channel | null,
  currentPubkey?: string,
) {
  return Boolean(
    currentPubkey &&
      channel?.channelType === "dm" &&
      channel.participantPubkeys.length > 0 &&
      channel.participantPubkeys.every(
        (pubkey) => normalizePubkey(pubkey) === normalizePubkey(currentPubkey),
      ),
  );
}

/** Keep the person's name in self conversations, with a localized “you” suffix. */
export function resolveDmParticipantLabel(
  input: Parameters<typeof resolveUserLabel>[0],
) {
  const label = resolveUserLabel({ ...input, preferResolvedSelfLabel: true });
  return input.currentPubkey &&
    normalizePubkey(input.pubkey) === normalizePubkey(input.currentPubkey)
    ? `${label} (${messageText("you")})`
    : label;
}

export function getDmParticipantPreview<T>(participants: readonly T[]) {
  const visibleParticipants = participants.slice(
    0,
    DM_PARTICIPANT_PREVIEW_LIMIT,
  );

  return {
    hiddenCount: Math.max(
      0,
      participants.length - DM_PARTICIPANT_PREVIEW_LIMIT,
    ),
    visibleParticipants,
  };
}

export function formatDmParticipantDisplayName(
  participants: readonly DmParticipantDisplay[],
  locale?: AirHopLocale,
) {
  const { hiddenCount, visibleParticipants } =
    getDmParticipantPreview(participants);
  const names = visibleParticipants.map(
    (participant) => participant.displayName,
  );

  return hiddenCount > 0
    ? [
        ...names,
        messageText("+{count} more", { count: hiddenCount }, locale),
      ].join(", ")
    : names.join(", ");
}

export function buildDirectMessageIntro({
  channel,
  currentPubkey,
  profiles,
  locale,
}: {
  channel: Channel | null;
  currentPubkey?: string;
  profiles?: UserProfileLookup;
  locale?: AirHopLocale;
}): DirectMessageIntro | null {
  if (channel?.channelType !== "dm") {
    return null;
  }

  const participants = channel.participantPubkeys.map((pubkey, index) => ({
    fallbackName: channel.participants[index] ?? null,
    pubkey,
  }));
  const normalizedCurrentPubkey = currentPubkey
    ? normalizePubkey(currentPubkey)
    : null;
  const otherParticipants = normalizedCurrentPubkey
    ? participants.filter(
        (participant) =>
          normalizePubkey(participant.pubkey) !== normalizedCurrentPubkey,
      )
    : participants;
  const displayParticipants =
    otherParticipants.length > 0 ? otherParticipants : participants;

  if (displayParticipants.length === 0) {
    return null;
  }

  const introParticipants = displayParticipants.map((participant) => {
    const profile = profiles?.[normalizePubkey(participant.pubkey)] ?? null;

    return {
      avatarUrl: profile?.avatarUrl ?? null,
      displayName: resolveDmParticipantLabel({
        currentPubkey,
        fallbackName: participant.fallbackName,
        profiles,
        pubkey: participant.pubkey,
      }),
      pubkey: participant.pubkey,
    };
  });

  return {
    isSelf: isSelfDirectMessage(channel, currentPubkey),
    displayName: formatDmParticipantDisplayName(introParticipants, locale),
    participants: introParticipants,
  };
}
