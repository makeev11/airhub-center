export type BookingPrimaryDestinationId =
  | "schedule"
  | "requests"
  | "clients"
  | "payments"
  | "analytics"
  | "settings";

export type BookingSettingsDestinationId =
  | "organization"
  | "branches"
  | "groups"
  | "tariffs"
  | "teachers"
  | "public-booking";

export type BookingRoute =
  | "/booking/schedule"
  | "/booking/requests"
  | "/booking/clients"
  | "/booking/branches"
  | "/booking/groups"
  | "/booking/tariffs"
  | "/booking/payments"
  | "/booking/analytics"
  | "/booking/teachers"
  | "/booking/settings";

export const PRIMARY_BOOKING_DESTINATIONS = [
  {
    id: "schedule",
    to: "/booking/schedule",
    testId: "open-airhop-schedule",
  },
  {
    id: "requests",
    to: "/booking/requests",
    testId: "open-airhop-requests",
  },
  {
    id: "clients",
    to: "/booking/clients",
    testId: "open-airhop-clients",
  },
  {
    id: "payments",
    to: "/booking/payments",
    testId: "open-airhop-payments",
  },
  {
    id: "analytics",
    to: "/booking/analytics",
    testId: "open-airhop-analytics",
  },
  {
    id: "settings",
    to: "/booking/settings",
    testId: "open-airhop-settings",
  },
] as const satisfies ReadonlyArray<{
  id: BookingPrimaryDestinationId;
  to: BookingRoute;
  testId: string;
}>;

export const SETTINGS_BOOKING_DESTINATIONS = [
  {
    id: "organization",
    to: "/booking/settings",
    testId: "open-airhop-settings-organization",
  },
  {
    id: "branches",
    to: "/booking/branches",
    testId: "open-airhop-branches",
  },
  {
    id: "groups",
    to: "/booking/groups",
    testId: "open-airhop-groups",
  },
  {
    id: "tariffs",
    to: "/booking/tariffs",
    testId: "open-airhop-tariffs",
  },
  {
    id: "teachers",
    to: "/booking/teachers",
    testId: "open-airhop-teachers",
  },
  {
    id: "public-booking",
    to: "/booking/settings",
    testId: "open-airhop-settings-public-booking",
    section: "public-booking",
  },
] as const satisfies ReadonlyArray<{
  id: BookingSettingsDestinationId;
  to: BookingRoute;
  testId: string;
  section?: "public-booking";
}>;
