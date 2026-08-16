import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const ClientsScreen = React.lazy(async () => {
  const module = await import("@/features/booking/ui/ClientsScreen");
  return { default: module.ClientsScreen };
});

export const Route = createFileRoute("/booking/clients/")({
  component: BookingClientsIndexRouteComponent,
});

function BookingClientsIndexRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <ClientsScreen />
    </React.Suspense>
  );
}
