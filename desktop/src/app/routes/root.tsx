import {
  createRootRoute,
  Navigate,
  Outlet,
  useLocation,
} from "@tanstack/react-router";

import { AppShell } from "@/app/AppShell";
import { resolveLegacyAirHopRoute } from "@/app/legacyAirHopRoute";
import { isPublicBookingPath } from "@/app/publicBookingRoute";

export const Route = createRootRoute({
  component: RootRouteBoundary,
});

function RootRouteBoundary() {
  const pathname = useLocation({ select: (location) => location.pathname });
  const isPublicBooking = isPublicBookingPath(pathname);
  if (!isPublicBooking && resolveLegacyAirHopRoute(pathname)) {
    return <Navigate replace to="/booking/schedule" />;
  }
  return isPublicBooking ? <Outlet /> : <AppShell />;
}
