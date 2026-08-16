import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  CalendarDays,
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

export function BookingSidebarNav({ isActive }: { isActive: boolean }) {
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
    <SidebarGroup className="px-0 pb-2 pt-1" data-testid="airhop-sidebar-nav">
      <SidebarGroupLabel className="font-semibold text-sidebar-foreground">
        {messages.productName}
      </SidebarGroupLabel>
      <SidebarGroupContent>
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
