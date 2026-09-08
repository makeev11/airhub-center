import { isTauri } from "@tauri-apps/api/core";

export type AirhopStaffDataRuntimeMode = "server" | "workspace";

export type AirhopStaffDataRuntimeSignals = {
  tauri: boolean;
  e2eMock: boolean;
};

/** Keeps authoritative staff reads out of browser demos and the E2E mock. */
export function resolveAirhopStaffDataRuntime(
  signals: AirhopStaffDataRuntimeSignals,
): AirhopStaffDataRuntimeMode {
  return signals.tauri && !signals.e2eMock ? "server" : "workspace";
}

/** Returns the staff data source appropriate for this application runtime. */
export function currentAirhopStaffDataRuntime(): AirhopStaffDataRuntimeMode {
  // Exercise the real HTTP read components behind the mock native bridge.
  // Vite removes this opt-in from normal desktop and public builds.
  if (
    import.meta.env?.MODE === "e2e" &&
    typeof window !== "undefined" &&
    (window as Window & { __AIRHOP_E2E_STAFF_SERVER__?: boolean })
      .__AIRHOP_E2E_STAFF_SERVER__ === true
  ) {
    return "server";
  }
  const e2eMock =
    typeof window !== "undefined" &&
    Boolean((window as Window & { __BUZZ_E2E__?: unknown }).__BUZZ_E2E__);
  return resolveAirhopStaffDataRuntime({
    tauri: isTauri(),
    e2eMock,
  });
}
