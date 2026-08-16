import * as React from "react";
import { useBlocker } from "@tanstack/react-router";

/**
 * Protects a Booking form from both in-app navigation and window unloads.
 * The browser owns the native beforeunload copy; SPA navigation uses the
 * localized confirmation supplied by the screen.
 */
export function useBookingUnsavedChangesGuard(
  dirty: boolean,
  confirmationMessage: string,
) {
  const shouldBlockFn = React.useCallback(
    () => !window.confirm(confirmationMessage),
    [confirmationMessage],
  );

  useBlocker({
    disabled: !dirty,
    enableBeforeUnload: dirty,
    shouldBlockFn,
  });
}
