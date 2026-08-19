import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const AgentsScreen = React.lazy(async () => {
  const module = await import("@/features/airhop-agents/ui/AirhopAgentsScreen");
  return { default: module.AirhopAgentsScreen };
});

export const Route = createFileRoute("/agents")({
  component: AgentsRouteComponent,
});

function AgentsRouteComponent() {
  return (
    <React.Suspense fallback={<ViewLoadingFallback kind="agents" />}>
      <AgentsScreen />
    </React.Suspense>
  );
}
