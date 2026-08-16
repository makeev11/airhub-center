import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const ScheduleScreen = React.lazy(async () => {
  const module = await import("@/features/booking/ui/ScheduleScreen");
  return { default: module.ScheduleScreen };
});

export const Route = createFileRoute("/booking/schedule")({
  component: BookingScheduleRouteComponent,
});

function BookingScheduleRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <ScheduleScreen />
    </React.Suspense>
  );
}
