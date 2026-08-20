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

function subscribeRouteChange(onStoreChange: () => void): () => void {
  window.addEventListener("hashchange", onStoreChange);
  window.addEventListener("popstate", onStoreChange);
  return () => {
    window.removeEventListener("hashchange", onStoreChange);
    window.removeEventListener("popstate", onStoreChange);
  };
}

export function publicBookingLocationPathname(
  hash: string,
  pathname: string,
  publicWeb: boolean,
): string {
  return publicWeb ? pathname : hashRouterPathname(hash);
}

/** True only for the relay-hosted public-booking bundle, never native Tauri. */
export function isAirhopPublicWebBuild(value: string | undefined): boolean {
  return value === "1";
}

export function useIsPublicBookingLocation(): boolean {
  const publicWeb = isAirhopPublicWebBuild(
    import.meta.env.VITE_AIRHOP_PUBLIC_WEB,
  );
  const pathname = React.useSyncExternalStore(
    subscribeRouteChange,
    () =>
      publicBookingLocationPathname(
        window.location.hash,
        window.location.pathname,
        publicWeb,
      ),
    () => "/",
  );
  return isPublicBookingPath(pathname);
}
