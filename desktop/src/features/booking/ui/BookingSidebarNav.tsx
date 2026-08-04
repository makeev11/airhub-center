import { useNavigate } from "@tanstack/react-router";
import {
  BarChart3,
  CalendarDays,
  ClipboardList,
  LayoutDashboard,
  Settings2,
  UsersRound,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import { isAirhopDemoRuntimeAvailable } from "@/features/booking/lib/demoRuntime";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

type BookingNavItem = {
  label: string;
  icon: LucideIcon;
  enabled?: boolean;
};

const BOOKING_NAV_ITEMS: BookingNavItem[] = [
  { label: "Обзор", icon: LayoutDashboard },
  { label: "Расписание", icon: CalendarDays, enabled: true },
  { label: "Записи", icon: ClipboardList },
  { label: "Клиенты", icon: UsersRound },
  { label: "Оплаты", icon: WalletCards },
  { label: "Аналитика", icon: BarChart3 },
  { label: "Настройки", icon: Settings2 },
];

export function BookingSidebarNav({ isActive }: { isActive: boolean }) {
  const navigate = useNavigate();

  return (
    <SidebarGroup className="px-0 pb-2 pt-1" data-testid="airhop-sidebar-nav">
      <SidebarGroupLabel className="font-semibold text-sidebar-foreground">
        Buzz AirHop
      </SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {BOOKING_NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton
                  aria-label={
                    item.enabled ? item.label : `${item.label} — скоро`
                  }
                  data-testid={
                    item.enabled ? "open-airhop-schedule" : undefined
                  }
                  disabled={!item.enabled}
                  isActive={item.enabled && isActive}
                  onClick={
                    item.enabled
                      ? () =>
                          void navigate({
                            to: "/booking/schedule",
                            search: isAirhopDemoRuntimeAvailable
                              ? { demo: "airhop" }
                              : {},
                          })
                      : undefined
                  }
                  tooltip={item.enabled ? item.label : `${item.label} — скоро`}
                  type="button"
                >
                  <Icon />
                  <SidebarMenuLabel>{item.label}</SidebarMenuLabel>
                </SidebarMenuButton>
                {!item.enabled ? (
                  <SidebarMenuBadge className="right-2 text-2xs text-muted-foreground">
                    Скоро
                  </SidebarMenuBadge>
                ) : null}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
