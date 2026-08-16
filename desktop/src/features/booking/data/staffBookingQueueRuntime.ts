import {
  currentAirhopStaffDataRuntime,
  resolveAirhopStaffDataRuntime,
  type AirhopStaffDataRuntimeMode,
  type AirhopStaffDataRuntimeSignals,
} from "@/features/booking/data/staffDataRuntime";

export type StaffBookingQueueRuntimeMode = AirhopStaffDataRuntimeMode;

export type StaffBookingQueueRuntimeSignals = AirhopStaffDataRuntimeSignals;

/**
 * Keeps the authoritative staff queue out of browser demos and the E2E mock.
 * Only a real desktop runtime may read and mutate the Booking Core queue.
 */
export function resolveStaffBookingQueueRuntime(
  signals: StaffBookingQueueRuntimeSignals,
): StaffBookingQueueRuntimeMode {
  return resolveAirhopStaffDataRuntime(signals);
}

/** Returns the booking-request data source appropriate for this runtime. */
export function currentStaffBookingQueueRuntime(): StaffBookingQueueRuntimeMode {
  return currentAirhopStaffDataRuntime();
}
