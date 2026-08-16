import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";

const PublicBookingManageCard = React.lazy(async () => {
  const module = await import("@/features/booking/ui/PublicBookingManageCard");
  return { default: module.PublicBookingManageCard };
});

export const Route = createFileRoute("/booking/manage/$token")({
  component: PublicBookingManageRoute,
});

function PublicBookingManageRoute() {
  const { token } = Route.useParams();
  return (
    <React.Suspense fallback={null}>
      <PublicBookingManageCard token={token} />
    </React.Suspense>
  );
}
