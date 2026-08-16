import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const TariffsScreen = React.lazy(async () => {
  const module = await import("@/features/booking/ui/TariffsScreen");
  return { default: module.TariffsScreen };
});

export const Route = createFileRoute("/booking/tariffs")({
  component: BookingTariffsRouteComponent,
});

function BookingTariffsRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <TariffsScreen />
    </React.Suspense>
  );
}
