import type * as React from "react";

import { AUXILIARY_PANEL_MIN_WIDTH_PX } from "@/shared/layout/AuxiliaryPanel";
import { cn } from "@/shared/lib/cn";
import { useAirHopLocale } from "@/features/activation/useAirHopLocale";

type RightAuxiliaryPaneProps = {
  canResetWidth: boolean;
  children: React.ReactNode;
  constrainToAvailableSpace?: boolean;
  onResetWidth: () => void;
  onResizeStart: (event: React.PointerEvent<HTMLButtonElement>) => void;
  testId?: string;
  widthPx: number;
};

export function RightAuxiliaryPane({
  canResetWidth,
  children,
  constrainToAvailableSpace = true,
  onResetWidth,
  onResizeStart,
  testId,
  widthPx,
}: RightAuxiliaryPaneProps) {
  const isRussian = useAirHopLocale() === "ru-RU";
  return (
    <aside
      className={cn(
        "group/right-pane relative flex h-full shrink-0 flex-col overflow-hidden bg-background before:pointer-events-none before:absolute before:bottom-0 before:left-0 before:top-0 before:z-50 before:w-px before:bg-border/80 before:content-['']",
      )}
      data-testid={testId}
      style={{
        maxWidth: constrainToAvailableSpace
          ? `calc(100% - ${AUXILIARY_PANEL_MIN_WIDTH_PX}px)`
          : undefined,
        width: widthPx,
      }}
    >
      <button
        aria-label={isRussian ? "Изменить ширину панели" : "Resize panel"}
        className="peer/right-pane-resize group/right-pane-resize absolute inset-y-0 left-0 z-50 w-3 -translate-x-1/2 cursor-col-resize"
        data-testid="right-auxiliary-pane-resize-handle"
        onDoubleClick={canResetWidth ? onResetWidth : undefined}
        onPointerDown={onResizeStart}
        title={
          canResetWidth
            ? isRussian
              ? "Потяните, чтобы изменить ширину. Двойной щелчок — сбросить."
              : "Drag to resize. Double-click to reset width."
            : isRussian
              ? "Потяните, чтобы изменить ширину."
              : "Drag to resize."
        }
        type="button"
      >
        <span className="absolute bottom-0 left-1/2 top-0 w-px -translate-x-1/2 bg-transparent group-hover/right-pane-resize:bg-border/80 group-focus-visible/right-pane-resize:bg-border/80" />
      </button>
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col">
        {children}
      </div>
    </aside>
  );
}
