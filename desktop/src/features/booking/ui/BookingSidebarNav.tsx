import * as React from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  CalendarDays,
  BookOpen,
  ChartNoAxesCombined,
  ChevronDown,
  Inbox,
  WalletCards,
  Settings2,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import { paymentQueueRows } from "@/features/booking/lib/bookingCommerceReadModels";
import { organizationLocalDateTime } from "@/features/booking/lib/bookingDateTime";
import { PRIMARY_BOOKING_DESTINATIONS } from "@/features/booking/lib/bookingNavigation";
import { cn } from "@/shared/lib/cn";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuBadge,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";

type BookingNavItem = {
  label: string;
  icon: LucideIcon;
  to: (typeof PRIMARY_BOOKING_DESTINATIONS)[number]["to"];
  testId: string;
  badge?: number;
};

// Preserve the Airhop section interaction recovered from e924c6a while using
// the current navigation catalog (including analytics and settings catalogs).
const SECTION_LABEL_BUTTON_CLASS =
  "group/section-label flex w-fit max-w-[calc(100%-3rem)] cursor-pointer appearance-none items-center gap-1 text-left transition-colors hover:text-sidebar-foreground focus-visible:text-sidebar-foreground";
const SECTION_LABEL_CHEVRON_CLASS =
  "relative size-2.5 shrink-0 text-current opacity-0 transition-[color,opacity] group-hover/sidebar-section:opacity-100 group-hover/section-label:opacity-100 group-focus-within/sidebar-section:opacity-100 group-focus-visible/section-label:opacity-100";

export function BookingSidebarNav({ isActive }: { isActive: boolean }) {
  const [isCollapsed, setIsCollapsed] = React.useState(false);
  const contentId = React.useId();
  const booking = useBookingWorkspace();
  const navigate = useNavigate();
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const messages = getBookingAdminMessages(
    booking.workspace?.organization.locale ?? "ru-RU",
  );
  const openPaymentCount = booking.workspace
    ? paymentQueueRows(
        booking.workspace,
        organizationLocalDateTime(
          booking.workspace.organization.timeZone,
          new Date(),
        ).date,
      ).filter(
        (row) =>
          row.displayState === "expected" || row.displayState === "overdue",
      ).length
    : 0;
  const pendingRequestCount = booking.workspace
    ? booking.workspace.bookings.filter(
        (candidate) => candidate.status === "pending_confirmation",
      ).length +
      booking.workspace.bookings.filter(
        (candidate) => candidate.transferRequest?.status === "pending",
      ).length
    : 0;
  const presentation = {
    inbox: {
      label: (booking.workspace?.organization.locale ?? "ru-RU").startsWith(
        "ru",
      )
        ? "Обращения"
        : "Client Inbox",
      icon: Inbox,
    },
    schedule: { label: messages.navSchedule, icon: CalendarDays },
    requests: {
      label: messages.navRequests,
      icon: Inbox,
      badge: pendingRequestCount,
    },
    clients: { label: messages.navClients, icon: UsersRound },
    payments: {
      label: messages.navPayments,
      icon: WalletCards,
      badge: openPaymentCount,
    },
    analytics: {
      label: messages.navAnalytics,
      icon: ChartNoAxesCombined,
    },
    knowledge: { label: messages.navKnowledge, icon: BookOpen },
    settings: { label: messages.navSettings, icon: Settings2 },
  } satisfies Record<
    (typeof PRIMARY_BOOKING_DESTINATIONS)[number]["id"],
    { label: string; icon: LucideIcon; badge?: number }
  >;
  const items: BookingNavItem[] = PRIMARY_BOOKING_DESTINATIONS.map(
    (destination) => ({
      ...destination,
      ...presentation[destination.id],
    }),
  );

  return (
    <SidebarGroup
      className="group/sidebar-section select-none px-0 pb-2 pt-1"
      data-testid="airhop-sidebar-nav"
    >
      <SidebarGroupLabel asChild>
        <button
          aria-controls={contentId}
          aria-expanded={!isCollapsed}
          className={SECTION_LABEL_BUTTON_CLASS}
          data-testid="airhop-section-label"
          onClick={() => setIsCollapsed((current) => !current)}
          type="button"
        >
          <span data-sidebar-section-title>{messages.productName}</span>
          <span aria-hidden="true" className={SECTION_LABEL_CHEVRON_CLASS}>
            <ChevronDown
              className={cn(
                "absolute left-1/2 top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2",
                isCollapsed ? "-rotate-90" : "rotate-0",
              )}
            />
          </span>
        </button>
      </SidebarGroupLabel>
      <SidebarGroupContent hidden={isCollapsed} id={contentId}>
        <SidebarMenu>
          {items.map((item) => {
            const Icon = item.icon;
            return (
              <SidebarMenuItem key={item.label}>
                <SidebarMenuButton
                  aria-label={item.label}
                  data-testid={item.testId}
                  isActive={isActive && pathname === item.to}
                  onClick={() => void navigate({ to: item.to })}
                  tooltip={item.label}
                  type="button"
                >
                  <Icon />
                  <SidebarMenuLabel>{item.label}</SidebarMenuLabel>
                  {item.badge ? (
                    <SidebarMenuBadge
                      aria-label={`${item.label}: ${item.badge}`}
                    >
                      {Math.min(item.badge, 99)}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
