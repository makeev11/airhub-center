import * as React from "react";

type PublicBookingEnterEvent = {
  altKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  isComposing: boolean;
  key: string;
  metaKey: boolean;
  repeat: boolean;
  shiftKey: boolean;
  target: EventTarget | null;
};

/**
 * Plain Enter advances the booking when the current focus has no conflicting
 * action. Selected choice buttons may advance; unselected choices keep their
 * native first-Enter selection behaviour.
 */
export function shouldActivatePublicBookingPrimaryAction(
  event: PublicBookingEnterEvent,
): boolean {
  if (
    event.key !== "Enter" ||
    event.repeat ||
    event.isComposing ||
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return false;
  }

  const target = event.target;
  if (
    !target ||
    typeof target !== "object" ||
    !("closest" in target) ||
    typeof target.closest !== "function"
  ) {
    return true;
  }

  const element = target as Element;
  if (
    element.closest(
      'textarea, [contenteditable]:not([contenteditable="false"])',
    )
  ) {
    return false;
  }

  const interactive = element.closest(
    'button, a[href], input, select, [role="button"], [role="checkbox"], [role="radio"]',
  );
  if (!interactive) return true;
  if (interactive.matches('[data-airhop-primary-action="true"]')) return false;
  if (interactive.matches('[aria-pressed="true"]')) return true;
  if (
    interactive.matches(
      'input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]):not([type="file"])',
    )
  ) {
    return true;
  }
  return interactive.matches(
    '[role="checkbox"][aria-checked="true"], input[type="checkbox"]:checked',
  );
}

export function useBookingEnter(focusPrimaryAction: boolean) {
  const actionRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (focusPrimaryAction) {
      actionRef.current?.focus({ preventScroll: true });
    }
  }, [focusPrimaryAction]);

  const onEnter = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const primaryAction = actionRef.current;
      if (
        !primaryAction ||
        primaryAction.disabled ||
        !shouldActivatePublicBookingPrimaryAction({
          altKey: event.altKey,
          ctrlKey: event.ctrlKey,
          defaultPrevented: event.defaultPrevented,
          isComposing: event.nativeEvent.isComposing,
          key: event.key,
          metaKey: event.metaKey,
          repeat: event.repeat,
          shiftKey: event.shiftKey,
          target: event.target,
        })
      ) {
        return;
      }
      event.preventDefault();
      primaryAction.click();
    },
    [],
  );

  return { actionRef, onEnter };
}
