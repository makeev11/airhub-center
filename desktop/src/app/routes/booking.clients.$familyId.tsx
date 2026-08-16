import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const FamilyDetailsScreen = React.lazy(async () => {
  const module = await import("@/features/booking/ui/FamilyDetailsScreen");
  return { default: module.FamilyDetailsScreen };
});

export const Route = createFileRoute("/booking/clients/$familyId")({
  component: BookingFamilyRouteComponent,
});

function BookingFamilyRouteComponent() {
  const { familyId } = Route.useParams();
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <FamilyDetailsScreen familyId={familyId} />
    </React.Suspense>
  );
}
