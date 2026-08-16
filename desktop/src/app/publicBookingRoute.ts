import * as React from "react";

/** Identifies routes that must render outside employee onboarding and shell. */
export function isPublicBookingPath(pathname: string): boolean {
  return (
    pathname === "/booking" ||
    pathname === "/booking/" ||
    pathname === "/booking/demo-host" ||
    /^\/booking\/manage\/[^/]+\/?$/.test(pathname)
  );
}

export function hashRouterPathname(hash: string): string {
  const route = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathname = "/"] = route.split("?");
  return pathname.startsWith("/") ? pathname : `/${pathname}`;
}

function subscribeHashChange(onStoreChange: () => void): () => void {
  window.addEventListener("hashchange", onStoreChange);
  return () => window.removeEventListener("hashchange", onStoreChange);
}

export function useIsPublicBookingLocation(): boolean {
  const pathname = React.useSyncExternalStore(
    subscribeHashChange,
    () => hashRouterPathname(window.location.hash),
    () => "/",
  );
  return isPublicBookingPath(pathname);
}
