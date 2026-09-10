import { useMessengerCopy, messageText } from "@/shared/locale/messengerCopy";
import * as React from "react";
import { Bot, Sparkles, UserPlus } from "lucide-react";
import { useAirHopLocale } from "@/features/activation/useAirHopLocale";

import {
  getChannelIntroDescription,
  getChannelIntroKind,
} from "@/features/channels/ui/ChannelPane.helpers";
import {
  isWelcomeChannel,
  isWelcomeExperienceChannel,
} from "@/features/onboarding/welcome";
import type { Channel } from "@/shared/api/types";

type ChannelIntroAction = {
  description?: string;
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  testId?: string;
};

/**
 * Builds the empty-channel intro block (heading, description, action cards)
 * for the channel timeline. Welcome introduces the existing registered team,
 * not generic channel or agent creation; other channels get member actions.
 */
export function useChannelIntro({
  activeChannel,
  onAddAgent,
  onOpenMembers,
}: {
  activeChannel: Channel | null;
  onAddAgent?: (options?: { beforeSend?: () => void }) => void;
  onBrowseChannels?: () => void;
  onCreateChannel?: () => void;
  onOpenMembers?: () => void;
  onWelcomeAddAgent?: () => void;
}) {
  const isRussian = useAirHopLocale() === "ru-RU";
  const m = useMessengerCopy();
  return React.useMemo(() => {
    if (!activeChannel || activeChannel.channelType === "dm") {
      return null;
    }

    const actions: ChannelIntroAction[] = [];
    if (isWelcomeExperienceChannel(activeChannel)) {
      return {
        actions,
        beginning: m("This is the beginning of your private welcome channel."),
        channelKindLabel: isWelcomeChannel(activeChannel)
          ? isRussian
            ? "закрытого приветственного канала"
            : "private welcome channel"
          : getChannelIntroKind(activeChannel),
        channelName: activeChannel.name,
        description: isRussian
          ? "Здесь вы познакомитесь с командой центра. Физ, администратор, аналитик и контент-маркетолог расскажут, с чем могут помочь."
          : "Meet your center’s team: Fizz, the administrator, analyst and content marketer will explain how they can help.",
        icon: <Sparkles aria-hidden className="h-7 w-7" />,
        leadIn: isRussian ? "Это начало" : undefined,
      };
    }

    if (!activeChannel.archivedAt && activeChannel.isMember) {
      if (onAddAgent) {
        actions.push({
          description: messageText("Add an AirHop agent here."),
          icon: <Bot aria-hidden className="h-6 w-6" />,
          label: messageText("Add AI agent"),
          onClick: onAddAgent,
          testId: "channel-intro-action-create-agent",
        });
      }

      if (onOpenMembers) {
        actions.push({
          description: messageText("Invite employees."),
          icon: <UserPlus aria-hidden className="h-6 w-6" />,
          label: messageText("Add employees"),
          onClick: onOpenMembers,
          testId: "channel-intro-action-add-people",
        });
      }
    }

    return {
      actions,
      beginning: m(
        activeChannel.visibility === "private"
          ? "This is the beginning of a private channel."
          : "This is the beginning of the channel.",
      ),
      channelKindLabel: getChannelIntroKind(activeChannel),
      channelName: activeChannel.name,
      description: getChannelIntroDescription(activeChannel),
    };
  }, [activeChannel, m, isRussian, onAddAgent, onOpenMembers]);
}
