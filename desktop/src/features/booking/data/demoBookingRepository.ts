import {
  BrowserPreviewBookingRepository,
  type BookingLockCoordinator,
  type BookingRepository,
} from "@/features/booking/data/bookingRepository";
import { isAirhopDemoRuntimeAvailable } from "@/features/booking/lib/demoRuntime";
import { detectBookingTimeZone } from "@/features/booking/lib/bookingTimeZones";
import type { BookingWorkspace } from "@/features/booking/model/bookingCore";
import { DEMO_BOOKING_WORKSPACE } from "@/features/booking/model/demoSchedule";

export const DEMO_BOOKING_STORAGE_KEY = "buzz-airhop.booking.workspace.v6";
const LEGACY_BOOKING_STORAGE_KEYS = [
  "buzz-airhop.booking.workspace.v5",
  "buzz-airhop.booking.workspace.v4",
  "buzz-airhop.booking.workspace.v3",
  "buzz-airhop.booking.workspace.v2",
] as const;

export function demoBookingStorageKey(storageScope?: string): string {
  const normalizedScope = storageScope?.trim();
  return normalizedScope
    ? `${DEMO_BOOKING_STORAGE_KEY}:${encodeURIComponent(normalizedScope)}`
    : DEMO_BOOKING_STORAGE_KEY;
}

export function createInitialDemoBookingWorkspace(
  timeZone = detectBookingTimeZone(),
): BookingWorkspace {
  return {
    ...DEMO_BOOKING_WORKSPACE,
    organization: {
      ...DEMO_BOOKING_WORKSPACE.organization,
      timeZone: detectBookingTimeZone(() => timeZone),
    },
  };
}

/** Moves the newest available preview workspace into the v6 scoped key. */
export function migrateLegacyPreviewStorage(
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">,
  scopedStorageKey: string,
  storageScope?: string,
): void {
  if (storage.getItem(scopedStorageKey) !== null) return;

  const normalizedScope = storageScope?.trim();
  const scopedLegacyKeys = LEGACY_BOOKING_STORAGE_KEYS.map((key) =>
    normalizedScope ? `${key}:${encodeURIComponent(normalizedScope)}` : key,
  );
  const legacyKey =
    scopedLegacyKeys.find((key) => storage.getItem(key) !== null) ??
    (normalizedScope
      ? LEGACY_BOOKING_STORAGE_KEYS.find((key) => storage.getItem(key) !== null)
      : null);
  if (!legacyKey) return;
  const legacyWorkspace = storage.getItem(legacyKey);
  if (legacyWorkspace === null) return;

  // Adopt the matching legacy workspace. The oldest preview had one global copy;
  // when encountered, only the community active during the upgrade claims it.
  storage.setItem(scopedStorageKey, legacyWorkspace);
  storage.removeItem(legacyKey);
}

function browserLockCoordinator(): BookingLockCoordinator | undefined {
  if (typeof navigator === "undefined" || !navigator.locks) return undefined;
  return {
    runExclusive: (name, task) =>
      navigator.locks.request(name, { mode: "exclusive" }, task),
  };
}

/**
 * The browser stand is allowed to persist changes locally so a settings edit
 * survives a reload. Production will inject the server-backed repository at
 * the same boundary; the UI does not need to know where the workspace lives.
 */
export function createDemoBookingRepository(
  storageScope?: string,
): BookingRepository | null {
  if (!isAirhopDemoRuntimeAvailable || typeof window === "undefined") {
    return null;
  }
  const storage = window.localStorage;
  if (!storage) return null;
  const storageKey = demoBookingStorageKey(storageScope);
  migrateLegacyPreviewStorage(storage, storageKey, storageScope);
  return new BrowserPreviewBookingRepository({
    storage,
    storageKey,
    initialWorkspace: createInitialDemoBookingWorkspace(),
    lockCoordinator: browserLockCoordinator(),
  });
}
