import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const PaymentsScreen = React.lazy(async () => {
  const module = await import("@/features/booking/ui/PaymentsScreen");
  return { default: module.PaymentsScreen };
});

export const Route = createFileRoute("/booking/payments")({
  component: BookingPaymentsRouteComponent,
});

function BookingPaymentsRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <PaymentsScreen />
    </React.Suspense>
  );
}
