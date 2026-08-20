import {
  createBrowserHistory,
  createHashHistory,
  createRouter,
} from "@tanstack/react-router";

import { routeTree } from "@/app/routeTree.gen";

export const router = createRouter({
  routeTree,
  // Tauri needs hash history because every native view is loaded from one
  // custom-protocol document. The relay-hosted public booking bundle is a real
  // web surface, so it keeps the canonical /booking URL instead.
  history:
    import.meta.env.VITE_AIRHOP_PUBLIC_WEB === "1"
      ? createBrowserHistory()
      : createHashHistory(),
  scrollRestoration: true,
  getScrollRestorationKey: (location: { pathname: string }) =>
    location.pathname,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
