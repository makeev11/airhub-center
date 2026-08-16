import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const BranchesScreen = React.lazy(async () => {
  const module = await import("@/features/booking/ui/BranchesScreen");
  return { default: module.BranchesScreen };
});

export const Route = createFileRoute("/booking/branches")({
  component: BookingBranchesRouteComponent,
});

function BookingBranchesRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <BranchesScreen />
    </React.Suspense>
  );
}
