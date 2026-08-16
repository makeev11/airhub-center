import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const BookingRequestsScreen = React.lazy(async () => {
  const module = await import("@/features/booking/ui/BookingRequestsScreen");
  return { default: module.BookingRequestsScreen };
});

export const Route = createFileRoute("/booking/requests")({
  component: BookingRequestsRouteComponent,
});

function BookingRequestsRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <BookingRequestsScreen />
    </React.Suspense>
  );
}
