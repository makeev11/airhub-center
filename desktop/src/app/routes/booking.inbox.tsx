import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";
const Screen = React.lazy(async () => ({
  default: (await import("@/features/client-inbox/ui/ClientInboxScreen"))
    .ClientInboxScreen,
}));
export const Route = createFileRoute("/booking/inbox")({
  component: () => (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <Screen />
    </React.Suspense>
  ),
});
