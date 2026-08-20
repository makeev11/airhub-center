import { EllipsisVertical, Settings2, Users } from "lucide-react";
import * as React from "react";
import { useAvailableAcpRuntimes } from "@/features/agents/hooks";
import { requestOpenCreateAgent } from "@/features/agents/openCreateAgentEvent";
import { useChannelMembersQuery } from "@/features/channels/hooks";
import type { Channel } from "@/shared/api/types";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import { AddChannelBotDialog } from "./AddChannelBotDialog";

type ChannelMembersBarProps = {
  channel: Channel;
  currentPubkey?: string;
  isAddBotOpen?: boolean;
  onAddBotOpenChange?: (open: boolean) => void;
  onManageChannel: () => void;
  onToggleMembers: () => void;
  variant?: "inline" | "compact";
};

export function ChannelMembersBar({
  channel,
  isAddBotOpen: isAddBotOpenProp,
  onAddBotOpenChange,
  onManageChannel,
  onToggleMembers,
  variant = "inline",
}: ChannelMembersBarProps) {
  const isRussian = useAirHopLocale() === "ru-RU";
  const [uncontrolledAddBotOpen, setUncontrolledAddBotOpen] =
    React.useState(false);
  const isAddBotOpen = isAddBotOpenProp ?? uncontrolledAddBotOpen;
  const setIsAddBotOpen = React.useCallback(
    (open: boolean) => {
      onAddBotOpenChange?.(open);
      if (isAddBotOpenProp === undefined) {
        setUncontrolledAddBotOpen(open);
      }
    },
    [isAddBotOpenProp, onAddBotOpenChange],
  );
  const membersQuery = useChannelMembersQuery(channel.id);
  const providersQuery = useAvailableAcpRuntimes();
  const memberCount = membersQuery.data?.length ?? channel.memberCount;
  const providers = React.useMemo(
    () =>
      [...(providersQuery.data ?? [])].sort((left, right) => {
        const leftPriority = left.id === "goose" ? 0 : 1;
        const rightPriority = right.id === "goose" ? 0 : 1;
        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        return left.label.localeCompare(right.label);
      }),
    [providersQuery.data],
  );
  const previousChannelIdRef = React.useRef(channel.id);

  React.useEffect(() => {
    if (previousChannelIdRef.current === channel.id) {
      return;
    }

    previousChannelIdRef.current = channel.id;
    setIsAddBotOpen(false);
  }, [channel.id, setIsAddBotOpen]);

  const dialogErrorMessage =
    providersQuery.error instanceof Error ? providersQuery.error.message : null;

  const controls =
    variant === "compact" ? (
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button
            aria-label={isRussian ? "Действия с каналом" : "Channel actions"}
            data-testid="channel-actions-menu-trigger"
            size="icon"
            type="button"
            variant="outline"
          >
            <EllipsisVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48" forceMount>
          <DropdownMenuItem
            data-testid="channel-members-trigger"
            onSelect={onToggleMembers}
          >
            <Users />
            <span>{isRussian ? "Участники" : "Members"}</span>
            <span className="ml-auto text-xs text-muted-foreground">
              {memberCount}
            </span>
          </DropdownMenuItem>
          <DropdownMenuItem
            data-testid="channel-management-trigger"
            onSelect={onManageChannel}
          >
            <Settings2 />
            <span>{isRussian ? "Настроить канал" : "Manage channel"}</span>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    ) : (
      <div className="flex items-center gap-[6px]">
        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <Button
              aria-label={
                isRussian
                  ? `Участники канала (${memberCount})`
                  : `View channel members (${memberCount})`
              }
              className="h-8 px-2.5"
              data-testid="channel-members-trigger"
              onClick={onToggleMembers}
              type="button"
              variant="outline"
            >
              <Users />
              <span className="min-w-[1ch] text-sm font-medium tabular-nums">
                {memberCount}
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isRussian ? "Участники канала" : "Channel members"}
          </TooltipContent>
        </Tooltip>

        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <Button
              aria-label={isRussian ? "Настроить канал" : "Manage channel"}
              data-testid="channel-management-trigger"
              onClick={onManageChannel}
              size="icon"
              type="button"
              variant="outline"
            >
              <EllipsisVertical />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isRussian ? "Настройки канала" : "Channel settings"}
          </TooltipContent>
        </Tooltip>
      </div>
    );

  return (
    <React.Fragment>
      {controls}

      <AddChannelBotDialog
        channelId={channel.id}
        onCreateAgent={() => {
          requestOpenCreateAgent({
            channelId: channel.id,
            channelName: channel.name,
          });
        }}
        onOpenChange={setIsAddBotOpen}
        open={isAddBotOpen}
        providers={providers}
        providersErrorMessage={dialogErrorMessage}
        providersLoading={providersQuery.isLoading}
      />
    </React.Fragment>
  );
}
