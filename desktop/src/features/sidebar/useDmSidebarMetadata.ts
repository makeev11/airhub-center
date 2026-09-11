import * as React from "react";

import { usePresenceQuery } from "@/features/presence/hooks";
import {
  isSelfDirectMessage,
  resolveDmParticipantLabel,
} from "@/features/channels/lib/dmParticipantDisplay";
import { useProfilesWithSelf } from "@/features/profile/useProfilesWithSelf";
import { useUsersBatchQuery } from "@/features/profile/hooks";
import { resolveChannelDisplayLabel } from "@/features/sidebar/lib/channelLabels";
import type { SidebarDmParticipant } from "@/features/sidebar/ui/SidebarSection";
import type { Channel, PresenceStatus } from "@/shared/api/types";

export function useDmSidebarMetadata({
  currentPubkey,
  directMessages,
  fallbackDisplayName,
  profileDisplayName,
  enabled = true,
  selfPresenceStatus,
}: {
  currentPubkey?: string;
  directMessages: Channel[];
  fallbackDisplayName?: string;
  profileDisplayName?: string | null;
  enabled?: boolean;
  selfPresenceStatus: PresenceStatus;
}) {
  const selfDmLabels = React.useMemo(
    () =>
      new Set(
        [profileDisplayName, fallbackDisplayName]
          .map((value) => value?.trim().toLowerCase())
          .filter((value): value is string => Boolean(value)),
      ),
    [fallbackDisplayName, profileDisplayName],
  );
  const dmParticipantPubkeys = React.useMemo(
    () =>
      directMessages.flatMap((channel) =>
        channel.participantPubkeys.filter((pubkey, index) => {
          const normalizedPubkey = pubkey.toLowerCase();
          if (normalizedPubkey === currentPubkey?.toLowerCase()) {
            return false;
          }

          const participantLabel =
            channel.participants[index]?.trim().toLowerCase() ?? null;
          return !participantLabel || !selfDmLabels.has(participantLabel);
        }),
      ),
    [currentPubkey, directMessages, selfDmLabels],
  );
  const dmPresenceQuery = usePresenceQuery(dmParticipantPubkeys, {
    enabled: enabled && directMessages.length > 0,
  });
  const dmProfilesQuery = useUsersBatchQuery(dmParticipantPubkeys, {
    enabled: enabled && directMessages.length > 0,
  });
  const dmProfiles = useProfilesWithSelf(
    dmProfilesQuery.data?.profiles,
    currentPubkey,
  );
  const dmPresenceByChannelId = React.useMemo(
    () =>
      Object.fromEntries(
        directMessages.map((channel) => {
          const otherParticipantPubkey = channel.participantPubkeys.find(
            (pubkey, index) => {
              const normalizedPubkey = pubkey.toLowerCase();
              if (normalizedPubkey === currentPubkey?.toLowerCase()) {
                return false;
              }

              const participantLabel =
                channel.participants[index]?.trim().toLowerCase() ?? null;
              return !participantLabel || !selfDmLabels.has(participantLabel);
            },
          );

          return [
            channel.id,
            isSelfDirectMessage(channel, currentPubkey)
              ? selfPresenceStatus
              : otherParticipantPubkey
                ? (dmPresenceQuery.data?.[
                    otherParticipantPubkey.toLowerCase()
                  ] ?? "offline")
                : "offline",
          ];
        }),
      ) satisfies Record<string, PresenceStatus>,
    [
      currentPubkey,
      directMessages,
      dmPresenceQuery.data,
      selfDmLabels,
      selfPresenceStatus,
    ],
  );
  const dmChannelLabels = React.useMemo(
    () =>
      Object.fromEntries(
        directMessages.map((channel) => [
          channel.id,
          resolveChannelDisplayLabel(channel, currentPubkey, dmProfiles),
        ]),
      ),
    [currentPubkey, directMessages, dmProfiles],
  );
  const dmParticipantsByChannelId = React.useMemo(
    () =>
      Object.fromEntries(
        directMessages.map((channel) => {
          const participants = channel.participantPubkeys.map(
            (pubkey, index) => ({
              fallbackName: channel.participants[index] ?? null,
              pubkey,
            }),
          );
          const otherParticipants = participants.filter((participant) => {
            if (
              participant.pubkey.toLowerCase() === currentPubkey?.toLowerCase()
            ) {
              return false;
            }

            const participantLabel =
              participant.fallbackName?.trim().toLowerCase() ?? null;
            return !participantLabel || !selfDmLabels.has(participantLabel);
          });
          const visibleParticipants =
            otherParticipants.length > 0 ? otherParticipants : participants;

          return [
            channel.id,
            visibleParticipants.map((participant) => ({
              avatarUrl:
                dmProfiles?.[participant.pubkey.toLowerCase()]?.avatarUrl ??
                null,
              label: resolveDmParticipantLabel({
                currentPubkey,
                fallbackName: participant.fallbackName,
                profiles: dmProfiles,
                pubkey: participant.pubkey,
              }),
              pubkey: participant.pubkey,
            })),
          ];
        }),
      ) satisfies Record<string, SidebarDmParticipant[]>,
    [currentPubkey, directMessages, dmProfiles, selfDmLabels],
  );

  return {
    dmChannelLabels,
    dmParticipantsByChannelId,
    dmPresenceByChannelId,
  };
}
