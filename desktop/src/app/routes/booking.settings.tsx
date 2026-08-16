import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

type BookingSettingsSearch = {
  section?: "public-booking";
};

function validateBookingSettingsSearch(
  search: Record<string, unknown>,
): BookingSettingsSearch {
  return search.section === "public-booking"
    ? { section: "public-booking" }
    : {};
}

const BookingSettingsScreen = React.lazy(async () => {
  const module = await import("@/features/booking/ui/BookingSettingsScreen");
  return { default: module.BookingSettingsScreen };
});

export const Route = createFileRoute("/booking/settings")({
  validateSearch: validateBookingSettingsSearch,
  component: BookingSettingsRouteComponent,
});

function BookingSettingsRouteComponent() {
  const { section } = Route.useSearch();
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <BookingSettingsScreen section={section ?? "organization"} />
    </React.Suspense>
  );
}
