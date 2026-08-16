import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const GroupsScreen = React.lazy(async () => {
  const module = await import("@/features/booking/ui/GroupsScreen");
  return { default: module.GroupsScreen };
});

export const Route = createFileRoute("/booking/groups")({
  component: BookingGroupsRouteComponent,
});

function BookingGroupsRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <GroupsScreen />
    </React.Suspense>
  );
}
