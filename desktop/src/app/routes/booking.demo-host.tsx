import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";

const PublicBookingDemoHost = React.lazy(async () => {
  const module = await import("@/features/booking/ui/PublicBookingDemoHost");
  return { default: module.PublicBookingDemoHost };
});

export const Route = createFileRoute("/booking/demo-host")({
  component: PublicBookingDemoHostRoute,
});

function PublicBookingDemoHostRoute() {
  return (
    <React.Suspense fallback={null}>
      <PublicBookingDemoHost />
    </React.Suspense>
  );
}
