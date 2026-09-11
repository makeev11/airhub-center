import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";
import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";
const Screen = React.lazy(async () => ({
  default: (await import("@/features/knowledge-base/ui/KnowledgeBaseScreen"))
    .KnowledgeBaseScreen,
}));
export const Route = createFileRoute("/booking/knowledge")({
  component: () => (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <Screen />
    </React.Suspense>
  ),
});
