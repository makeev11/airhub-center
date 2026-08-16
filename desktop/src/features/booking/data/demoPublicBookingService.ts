import { createDemoBookingRepository } from "@/features/booking/data/demoBookingRepository";
import {
  WorkspacePublicBookingService,
  type PublicBookingService,
} from "@/features/booking/data/publicBookingService";

const PUBLIC_DEMO_FALLBACK_SCOPE = "public-preview";

function activeDemoStorageScope(): string {
  if (typeof window === "undefined") return PUBLIC_DEMO_FALLBACK_SCOPE;
  try {
    return (
      window.localStorage.getItem("buzz-active-community-id")?.trim() ||
      PUBLIC_DEMO_FALLBACK_SCOPE
    );
  } catch {
    return PUBLIC_DEMO_FALLBACK_SCOPE;
  }
}

/**
 * Creates the browser-preview public adapter. It deliberately reuses the demo
 * workspace repository only at this composition boundary; production must
 * inject a server implementation of PublicBookingService.
 */
export function createDemoPublicBookingService(): PublicBookingService | null {
  const repository = createDemoBookingRepository(activeDemoStorageScope());
  return repository ? new WorkspacePublicBookingService(repository) : null;
}
