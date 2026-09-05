import { useNavigate } from "@tanstack/react-router";
import {
  BadgeDollarSign,
  Building2,
  GraduationCap,
  Landmark,
  MessagesSquare,
  MonitorSmartphone,
  UsersRound,
  type LucideIcon,
} from "lucide-react";

import { getBookingAdminMessages } from "@/features/booking/lib/bookingAdminLocale";
import {
  SETTINGS_BOOKING_DESTINATIONS,
  type BookingSettingsDestinationId,
} from "@/features/booking/lib/bookingNavigation";
import { useBookingWorkspace } from "@/features/booking/data/BookingWorkspaceProvider";
import { useAirHopLocale } from "@/shared/locale/useAirHopLocale";
import { Button } from "@/shared/ui/button";
import { cn } from "@/shared/lib/cn";

export function BookingSettingsNav({
  active,
  className,
}: {
  active: BookingSettingsDestinationId;
  className?: string;
}) {
  const booking = useBookingWorkspace();
  const locale = useAirHopLocale();
  const navigate = useNavigate();
  const messages = getBookingAdminMessages(
    booking.workspace?.organization.locale ?? "ru-RU",
  );
  const presentation = {
    organization: {
      label: messages.organizationCardTitle,
      icon: Landmark,
    },
    branches: { label: messages.navBranches, icon: Building2 },
    groups: { label: messages.navGroups, icon: UsersRound },
    tariffs: { label: messages.navTariffs, icon: BadgeDollarSign },
    teachers: { label: messages.navTeachers, icon: GraduationCap },
    channels: {
      label:
        locale === "ru-RU"
          ? "Каналы связи"
          : locale === "pt-BR"
            ? "Canais"
            : locale === "tr-TR"
              ? "Kanallar"
              : "Channels",
      icon: MessagesSquare,
    },
    "public-booking": {
      label: messages.publicBookingCardTitle,
      icon: MonitorSmartphone,
    },
  } satisfies Record<
    BookingSettingsDestinationId,
    { label: string; icon: LucideIcon }
  >;

  return (
    <nav
      aria-label={messages.settingsSectionsLabel}
      className={cn("overflow-x-auto pb-1", className)}
      data-testid="airhop-settings-nav"
    >
      <div className="flex min-w-max gap-2">
        {SETTINGS_BOOKING_DESTINATIONS.map((destination) => {
          const item = presentation[destination.id];
          const Icon = item.icon;
          const isActive = active === destination.id;
          return (
            <Button
              aria-current={isActive ? "page" : undefined}
              className="shrink-0"
              data-testid={destination.testId}
              key={destination.id}
              onClick={() => {
                if ("section" in destination) {
                  void navigate({
                    to: "/booking/settings",
                    search: { section: destination.section },
                  });
                  return;
                }
                if (destination.id === "organization") {
                  void navigate({ to: "/booking/settings", search: {} });
                  return;
                }
                void navigate({ to: destination.to });
              }}
              size="sm"
              type="button"
              variant={isActive ? "secondary" : "ghost"}
            >
              <Icon />
              {item.label}
            </Button>
          );
        })}
      </div>
    </nav>
  );
}
