import { isTauri } from "@tauri-apps/api/core";

export type StaffBookingQueueRuntimeMode = "server" | "workspace";

export type StaffBookingQueueRuntimeSignals = {
  tauri: boolean;
  e2eMock: boolean;
};

/**
 * Keeps the authoritative staff queue out of browser demos and the E2E mock.
 * Only a real desktop runtime may read and mutate the Booking Core queue.
 */
export function resolveStaffBookingQueueRuntime(
  signals: StaffBookingQueueRuntimeSignals,
): StaffBookingQueueRuntimeMode {
  return signals.tauri && !signals.e2eMock ? "server" : "workspace";
}

/** Returns the booking-request data source appropriate for this runtime. */
export function currentStaffBookingQueueRuntime(): StaffBookingQueueRuntimeMode {
  const e2eMock =
    typeof window !== "undefined" &&
    Boolean((window as Window & { __BUZZ_E2E__?: unknown }).__BUZZ_E2E__);
  return resolveStaffBookingQueueRuntime({
    tauri: isTauri(),
    e2eMock,
  });
}
