import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const TeachersScreen = React.lazy(async () => {
  const module = await import("@/features/booking/ui/TeachersScreen");
  return { default: module.TeachersScreen };
});

export const Route = createFileRoute("/booking/teachers")({
  component: BookingTeachersRouteComponent,
});

function BookingTeachersRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <TeachersScreen />
    </React.Suspense>
  );
}
