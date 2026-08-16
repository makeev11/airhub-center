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
  const e2eMock =
    typeof window !== "undefined" &&
    Boolean((window as Window & { __BUZZ_E2E__?: unknown }).__BUZZ_E2E__);
  return resolveAirhopStaffDataRuntime({
    tauri: isTauri(),
    e2eMock,
  });
}
