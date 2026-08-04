import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

type BookingScheduleSearch = {
  demo?: string;
};

const ScheduleScreen = React.lazy(async () => {
  const module = await import("@/features/booking/ui/ScheduleScreen");
  return { default: module.ScheduleScreen };
});

export const Route = createFileRoute("/booking/schedule")({
  validateSearch: (search: Record<string, unknown>): BookingScheduleSearch => ({
    demo: typeof search.demo === "string" ? search.demo : undefined,
  }),
  component: BookingScheduleRouteComponent,
});

function BookingScheduleRouteComponent() {
  const { demo } = Route.useSearch();
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <ScheduleScreen requestedDemo={demo} />
    </React.Suspense>
  );
}
