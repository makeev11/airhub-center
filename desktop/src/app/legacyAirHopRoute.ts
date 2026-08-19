const AIRHOP_EXACT_ROUTES = new Set([
  "/",
  "/agents",
  "/messages/new",
  "/reminders",
  "/settings",
]);
const AIRHOP_ROUTE_PREFIXES = Object.freeze(["/booking/", "/channels/"]);

export const AIRHOP_SAFE_START_ROUTE = "/booking/schedule" as const;

export function resolveLegacyAirHopRoute(pathname: string): string | null {
  const isAllowedRoute =
    AIRHOP_EXACT_ROUTES.has(pathname) ||
    AIRHOP_ROUTE_PREFIXES.some((prefix) => pathname.startsWith(prefix));

  return isAllowedRoute ? null : AIRHOP_SAFE_START_ROUTE;
}
