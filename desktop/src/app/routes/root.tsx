import { createRootRoute, Outlet, useLocation } from "@tanstack/react-router";

import { AppShell } from "@/app/AppShell";
import { isPublicBookingPath } from "@/app/publicBookingRoute";

export const Route = createRootRoute({
  component: RootRouteBoundary,
});

function RootRouteBoundary() {
  const pathname = useLocation({ select: (location) => location.pathname });
  return isPublicBookingPath(pathname) ? <Outlet /> : <AppShell />;
}
