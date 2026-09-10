import {
  Check,
  ChevronDown,
  ChevronRight,
  Link2,
  MoreHorizontal,
  Plus,
  Settings2,
  Ticket,
  WifiOff,
} from "lucide-react";
import * as React from "react";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";

import type { Community } from "@/features/communities/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/shared/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { Popover, PopoverContent, PopoverTrigger } from "@/shared/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import type { ConnectionState } from "@/shared/api/relayClientShared";
import {
  isRelayConnectionDegraded,
  useRelayConnection,
} from "@/shared/api/useRelayConnection";
import { writeTextToClipboard } from "@/shared/lib/clipboard";
import { useActiveCommunityIcon } from "@/features/communities/useCommunityIcons";
import { CommunityIcon } from "./CommunityIcon";
import { EditCommunityDialog } from "./EditCommunityDialog";

const CONNECTION_STATE_LABEL: Record<ConnectionState, string> = {
  idle: "Not connected",
  connecting: "Connecting…",
  connected: "Connected",
  reconnecting: "Reconnecting to relay…",
  stalled: "Connection lost — relay is not responding",
  disconnected: "Disconnected from relay",
};
const CONNECTION_STATE_RU: Record<ConnectionState, string> = {
  idle: "Не подключён",
  connecting: "Подключение…",
  connected: "Подключён",
  reconnecting: "Восстанавливаем соединение…",
  stalled: "Сервер не отвечает",
  disconnected: "Соединение разорвано",
};

type CommunitySwitcherProps = {
  activeCommunity: Community | null;
  communities: Community[];
  variant?: "sidebar" | "profile" | "profile-menu";
  canInvite?: boolean;
  onInvite?: () => void;
  onSwitchCommunity: (id: string) => void;
  onAddCommunity: () => void;
  onUpdateCommunity: (
    id: string,
    updates: Partial<Pick<Community, "name" | "relayUrl" | "token">>,
  ) => void;
  onRemoveCommunity: (id: string) => void;
};

export function CommunitySwitcher({
  activeCommunity,
  communities,
  variant = "sidebar",
  canInvite = false,
  onInvite,
  onSwitchCommunity,
  onAddCommunity,
  onUpdateCommunity,
  onRemoveCommunity,
}: CommunitySwitcherProps) {
  const isRussian = useAirHopLocale() === "ru-RU";
  const [editingCommunity, setEditingCommunity] =
    React.useState<Community | null>(null);
  const [dropdownOpen, setDropdownOpen] = React.useState(false);
  const profileMenuHoverTimer = React.useRef<number | null>(null);
  const connectionState = useRelayConnection();
  const degraded = isRelayConnectionDegraded(connectionState);
  const connectionLabel = (
    isRussian ? CONNECTION_STATE_RU : CONNECTION_STATE_LABEL
  )[connectionState];
  const activeIconQuery = useActiveCommunityIcon(activeCommunity?.relayUrl);
  const activeIcon = activeIconQuery.data ?? null;
  const isProfileVariant = variant === "profile";

  function clearProfileMenuHoverTimer() {
    if (profileMenuHoverTimer.current !== null) {
      window.clearTimeout(profileMenuHoverTimer.current);
      profileMenuHoverTimer.current = null;
    }
  }

  function scheduleProfileMenu(nextOpen: boolean) {
    if (variant !== "profile-menu") return;
    clearProfileMenuHoverTimer();
    profileMenuHoverTimer.current = window.setTimeout(
      () => setDropdownOpen(nextOpen),
      nextOpen ? 80 : 160,
    );
  }

  function handleProfileMenuOpenChange(nextOpen: boolean) {
    if (variant !== "profile-menu") {
      setDropdownOpen(nextOpen);
      return;
    }
    if (!nextOpen) {
      clearProfileMenuHoverTimer();
    }
    setDropdownOpen(nextOpen);
  }

  React.useEffect(
    () => () => {
      if (profileMenuHoverTimer.current !== null) {
        window.clearTimeout(profileMenuHoverTimer.current);
      }
    },
    [],
  );

  const triggerContent = (
    <>
      {degraded ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <span
              aria-hidden="false"
              className={
                isProfileVariant
                  ? "flex h-5 w-5 shrink-0 animate-pulse items-center justify-center rounded-md border border-sidebar-border/70 bg-sidebar-accent/40 text-destructive"
                  : "flex h-5 w-5 shrink-0 animate-pulse items-center justify-center text-destructive"
              }
              data-testid="relay-connection-warning"
              role="img"
            >
              <WifiOff className={isProfileVariant ? "h-4 w-4" : "h-4 w-4"} />
            </span>
          </TooltipTrigger>
          <TooltipContent side={isProfileVariant ? "top" : "bottom"}>
            {connectionLabel}
          </TooltipContent>
        </Tooltip>
      ) : (
        <CommunityIcon className="h-5 w-5 text-base" iconUrl={activeIcon} />
      )}
      <span
        className={
          degraded
            ? "min-w-0 flex-1 truncate font-medium text-destructive animate-pulse"
            : "min-w-0 flex-1 truncate font-medium"
        }
      >
        {activeCommunity?.name ??
          (isRussian ? "Центр не выбран" : "No community")}
      </span>
      {variant === "profile-menu" ? (
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      ) : (
        <ChevronDown
          className={
            isProfileVariant
              ? "h-4 w-4 shrink-0 text-sidebar-foreground/45"
              : "h-4 w-4 shrink-0 text-sidebar-foreground/50"
          }
        />
      )}
    </>
  );

  const profileMenuPopover =
    variant === "profile-menu" ? (
      <Popover open={dropdownOpen} onOpenChange={handleProfileMenuOpenChange}>
        <PopoverTrigger asChild>
          <button
            aria-expanded={dropdownOpen}
            aria-haspopup="menu"
            aria-label={
              degraded
                ? `${activeCommunity?.name ?? "Community"} — ${connectionLabel}`
                : isRussian
                  ? "Действия центра"
                  : "Community actions"
            }
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-popover-foreground outline-hidden transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none focus-visible:bg-muted/50 focus-visible:outline-none data-[state=open]:bg-muted/50 data-[state=open]:text-popover-foreground"
            data-testid="community-switcher"
            onMouseEnter={() => scheduleProfileMenu(true)}
            onMouseLeave={() => scheduleProfileMenu(false)}
            role="menuitem"
            type="button"
          >
            {triggerContent}
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          className="w-60 p-1"
          onMouseEnter={() => scheduleProfileMenu(true)}
          onMouseLeave={() => scheduleProfileMenu(false)}
          onOpenAutoFocus={(event) => event.preventDefault()}
          side="right"
          sideOffset={0}
        >
          <div
            aria-label={isRussian ? "Действия центра" : "Community actions"}
            data-testid="profile-community-actions"
            role="menu"
          >
            {activeCommunity ? (
              <>
                <button
                  className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-hidden transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none focus-visible:bg-muted/50 focus-visible:outline-none"
                  onClick={() => {
                    setDropdownOpen(false);
                    void writeTextToClipboard(activeCommunity.relayUrl);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Link2 className="h-4 w-4" />
                  <span>
                    {isRussian
                      ? "Скопировать ссылку центра"
                      : "Copy community URL"}
                  </span>
                </button>
                {canInvite && onInvite ? (
                  <button
                    className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-hidden transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none focus-visible:bg-muted/50 focus-visible:outline-none"
                    onClick={() => {
                      setDropdownOpen(false);
                      onInvite();
                    }}
                    role="menuitem"
                    type="button"
                  >
                    <Ticket className="h-4 w-4" />
                    <span>
                      {isRussian ? "Пригласить в центр" : "Invite to community"}
                    </span>
                  </button>
                ) : null}
                <button
                  className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-hidden transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none focus-visible:bg-muted/50 focus-visible:outline-none"
                  onClick={() => {
                    setDropdownOpen(false);
                    setEditingCommunity(activeCommunity);
                  }}
                  role="menuitem"
                  type="button"
                >
                  <Settings2 className="h-4 w-4" />
                  <span>
                    {isRussian ? "Настройки центра" : "Community settings"}
                  </span>
                </button>
                <hr className="-mx-1 my-1 h-px border-0 bg-muted" />
              </>
            ) : null}
            <button
              className="flex min-h-9 w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm outline-hidden transition-colors hover:bg-muted/50 focus:bg-muted/50 focus:outline-none focus-visible:bg-muted/50 focus-visible:outline-none"
              onClick={() => {
                setDropdownOpen(false);
                onAddCommunity();
              }}
              role="menuitem"
              type="button"
            >
              <Plus className="h-4 w-4" />
              <span>{isRussian ? "Добавить центр" : "Add a community"}</span>
            </button>
          </div>
        </PopoverContent>
      </Popover>
    ) : null;

  const switcherDropdown = (
    <DropdownMenu
      modal={false}
      open={dropdownOpen}
      onOpenChange={setDropdownOpen}
    >
      <DropdownMenuTrigger asChild>
        {variant === "profile" ? (
          <button
            aria-label={
              degraded
                ? `${activeCommunity?.name ?? "Community"} — ${connectionLabel}`
                : isRussian
                  ? "Выбрать центр"
                  : "Switch community"
            }
            className="flex min-w-0 max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-xs text-sidebar-foreground/50 outline-hidden transition-colors hover:text-sidebar-foreground focus:outline-none focus-visible:outline-none data-[state=open]:text-sidebar-foreground"
            data-testid="community-switcher"
            type="button"
          >
            {triggerContent}
          </button>
        ) : (
          <SidebarMenuButton
            aria-label={
              degraded
                ? `${activeCommunity?.name ?? "Community"} — ${connectionLabel}`
                : undefined
            }
            className="h-auto gap-2 rounded-xl px-2.5 py-2 data-[state=open]:bg-sidebar-accent"
            data-testid="community-switcher"
            type="button"
          >
            {triggerContent}
          </SidebarMenuButton>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-(--radix-dropdown-menu-trigger-width) min-w-[220px]"
        onCloseAutoFocus={(e) => e.preventDefault()}
        side={variant === "profile" ? "top" : "bottom"}
        sideOffset={4}
      >
        {communities.map((community) => (
          <DropdownMenuItem
            key={community.id}
            className="group flex items-center gap-2 pr-1"
            onSelect={() => {
              onSwitchCommunity(community.id);
            }}
          >
            <span className="flex h-4 w-4 shrink-0 items-center justify-center">
              {activeCommunity?.id === community.id ? (
                <Check className="h-4 w-4 text-primary" />
              ) : null}
            </span>
            <span className="min-w-0 flex-1 truncate">{community.name}</span>
            <button
              aria-label={`Edit ${community.name}`}
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded opacity-0 hover:bg-accent group-hover:opacity-100 group-focus:opacity-100"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setDropdownOpen(false);
                setEditingCommunity(community);
              }}
              type="button"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onAddCommunity}>
          <Plus className="h-4 w-4" />
          <span>{isRussian ? "Добавить центр" : "Add a community"}</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <>
      {variant === "profile" ? (
        switcherDropdown
      ) : variant === "profile-menu" ? (
        profileMenuPopover
      ) : (
        <SidebarMenu>
          <SidebarMenuItem>{switcherDropdown}</SidebarMenuItem>
        </SidebarMenu>
      )}

      <EditCommunityDialog
        canRemove={communities.length > 1}
        onOpenChange={(open) => {
          if (!open) setEditingCommunity(null);
        }}
        onRemove={onRemoveCommunity}
        onSave={onUpdateCommunity}
        open={editingCommunity !== null}
        community={editingCommunity}
        showIconEditor={editingCommunity?.id === activeCommunity?.id}
      />
    </>
  );
}
