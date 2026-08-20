import { Bot, Inbox } from "lucide-react";

import { BookingSidebarNav } from "@/features/booking/ui/BookingSidebarNav";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { TopbarSearch } from "@/features/search/ui/TopbarSearch";
import { AirHopWordmark } from "@/shared/ui/airhop-brand/AirHopBrand";
import type { Channel, SearchHit } from "@/shared/api/types";
import {
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

type SidebarSelectedView =
  | "home"
  | "channel"
  | "messages"
  | "agents"
  | "booking";

type AppSidebarPinnedHeaderProps = {
  channelLabels: Record<string, string>;
  currentPubkey?: string;
  onBrowseChannels?: () => void;
  onCreateAgent: () => void;
  onCreateChannel: () => void;
  onOpenDm: (input: { pubkeys: string[] }) => Promise<void>;
  onOpenSearchResult: (hit: SearchHit) => void;
  onSelectChannel: (channelId: string) => void;
  searchChannels: Channel[];
  searchFocusRequest: number;
  suggestionChannels: Channel[];
};

type AppSidebarPrimaryMenuProps = {
  homeBadgeCount: number;
  onSelectAgents: () => void;
  onSelectHome: () => void;
  selectedView: SidebarSelectedView;
};

export function AppSidebarPinnedHeader({
  channelLabels,
  currentPubkey,
  onBrowseChannels,
  onCreateAgent,
  onCreateChannel,
  onOpenDm,
  onOpenSearchResult,
  onSelectChannel,
  searchChannels,
  searchFocusRequest,
  suggestionChannels,
}: AppSidebarPinnedHeaderProps) {
  return (
    <div
      className="mx-[3px] shrink-0 px-2 pb-2 pt-3"
      data-testid="sidebar-pinned-header"
    >
      <div
        className="mb-2 flex h-8 items-center px-1 text-lg"
        data-tauri-drag-region
        data-testid="sidebar-airhop-wordmark"
      >
        <AirHopWordmark />
      </div>
      <TopbarSearch
        channelLabels={channelLabels}
        channels={searchChannels}
        currentPubkey={currentPubkey}
        focusRequest={searchFocusRequest}
        onOpenChannel={onSelectChannel}
        onOpenResult={onOpenSearchResult}
        onOpenUser={(user) => onOpenDm({ pubkeys: [user.pubkey] })}
        onBrowseChannels={onBrowseChannels}
        onCreateAgent={onCreateAgent}
        onCreateChannel={onCreateChannel}
        suggestionChannels={suggestionChannels}
      />
    </div>
  );
}

export function AppSidebarPrimaryMenu({
  homeBadgeCount,
  onSelectAgents,
  onSelectHome,
  selectedView,
}: AppSidebarPrimaryMenuProps) {
  const locale = useAirHopLocale();
  const inboxLabel = locale === "ru-RU" ? "Входящие" : "Inbox";
  const agentsLabel = locale === "ru-RU" ? "AI-агенты" : "AI agents";

  return (
    <SidebarHeader
      className="relative z-40 cursor-default select-none px-2 pb-0 pt-0"
      data-tauri-drag-region
      data-testid="sidebar-primary-menu"
    >
      <SidebarMenu className="pb-2">
        <SidebarMenuItem>
          <SidebarMenuButton
            isActive={selectedView === "home"}
            onClick={onSelectHome}
            tooltip={inboxLabel}
            type="button"
          >
            <Inbox className="h-4 w-4" />
            <SidebarMenuLabel>{inboxLabel}</SidebarMenuLabel>
          </SidebarMenuButton>
          {homeBadgeCount > 0 ? (
            <SidebarMenuBadge
              className="right-2 rounded-full bg-primary/15 px-1.5 text-2xs text-primary peer-data-[active=true]/menu-button:bg-sidebar-active-foreground/20 peer-data-[active=true]/menu-button:text-sidebar-active-foreground"
              data-testid="sidebar-home-count"
            >
              {Math.min(homeBadgeCount, 99)}
            </SidebarMenuBadge>
          ) : null}
        </SidebarMenuItem>
        <SidebarMenuItem>
          <SidebarMenuButton
            data-testid="open-agents-view"
            isActive={selectedView === "agents"}
            onClick={onSelectAgents}
            tooltip={agentsLabel}
            type="button"
          >
            <Bot className="h-4 w-4" />
            <SidebarMenuLabel>{agentsLabel}</SidebarMenuLabel>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
      <BookingSidebarNav isActive={selectedView === "booking"} />
    </SidebarHeader>
  );
}
