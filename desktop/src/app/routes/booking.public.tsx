import { createFileRoute } from "@tanstack/react-router";
import * as React from "react";

import type { PublicBookingInitialContext } from "@/features/booking/ui/PublicBookingFlow";

const PublicBookingFlow = React.lazy(async () => {
  const module = await import("@/features/booking/ui/PublicBookingFlow");
  return { default: module.PublicBookingFlow };
});

function optionalId(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(value)
    ? value
    : undefined;
}

function optionalInteger(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isInteger(value)) return value;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

export const Route = createFileRoute("/booking/")({
  validateSearch: (search): PublicBookingInitialContext => ({
    ...(optionalId(search.branchId)
      ? { branchId: optionalId(search.branchId) }
      : {}),
    ...(optionalId(search.groupId)
      ? { groupId: optionalId(search.groupId) }
      : {}),
    ...(optionalInteger(search.birthYear) !== undefined
      ? { birthYear: optionalInteger(search.birthYear) }
      : {}),
    ...(optionalInteger(search.birthMonth) !== undefined
      ? { birthMonth: optionalInteger(search.birthMonth) }
      : {}),
    ...(optionalInteger(search.ageYears) !== undefined
      ? { ageYears: optionalInteger(search.ageYears) }
      : {}),
  }),
  component: PublicBookingRoute,
});

function PublicBookingRoute() {
  const initialContext = Route.useSearch();
  const flowKey = [
    initialContext.branchId ?? "",
    initialContext.groupId ?? "",
    initialContext.birthYear ?? "",
    initialContext.birthMonth ?? "",
    initialContext.ageYears ?? "",
  ].join(":");
  return (
    <React.Suspense fallback={null}>
      <PublicBookingFlow
        initialContext={initialContext}
        key={flowKey}
        mode="standalone"
      />
    </React.Suspense>
  );
}
