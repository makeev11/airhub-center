import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const PaymentAnalyticsScreen = React.lazy(async () => {
  const module = await import("@/features/booking/ui/PaymentAnalyticsScreen");
  return { default: module.PaymentAnalyticsScreen };
});

export const Route = createFileRoute("/booking/analytics")({
  component: BookingAnalyticsRouteComponent,
});

function BookingAnalyticsRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <PaymentAnalyticsScreen />
    </React.Suspense>
  );
}
