export type PublicBookingRoutingMode = "hash" | "history";

type PublicBookingLocation = Pick<Location, "hash" | "origin">;

export function publicBookingRoutingMode(
  location: Pick<PublicBookingLocation, "hash">,
): PublicBookingRoutingMode {
  return location.hash.startsWith("#/") ? "hash" : "history";
}

export function buildBranchPublicBookingUrl({
  branchId,
  origin,
  routingMode,
}: {
  branchId: string;
  origin: string;
  routingMode: PublicBookingRoutingMode;
}): string {
  const normalizedOrigin = new URL(origin).origin;
  const search = new URLSearchParams({ branchId }).toString();
  return routingMode === "hash"
    ? `${normalizedOrigin}/#/booking?${search}`
    : `${normalizedOrigin}/booking?${search}`;
}

export function buildBranchPublicBookingUrlForLocation(
  location: PublicBookingLocation,
  branchId: string,
): string {
  return buildBranchPublicBookingUrl({
    branchId,
    origin: location.origin,
    routingMode: publicBookingRoutingMode(location),
  });
}
