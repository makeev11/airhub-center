import type * as React from "react";

import {
  AIRHOP_MARK_PATH,
  AIRHOP_PRODUCT_NAME,
} from "@/shared/brand/airhopBrand";
import { cn } from "@/shared/lib/cn";
import "./airhop-brand.css";

type AirHopMarkProps = Omit<React.ComponentProps<"img">, "alt" | "src"> & {
  decorative?: boolean;
};

export function AirHopMark({
  className,
  decorative = true,
  ...props
}: AirHopMarkProps) {
  return (
    <img
      alt={decorative ? "" : AIRHOP_PRODUCT_NAME}
      className={cn("block shrink-0 object-contain", className)}
      decoding="async"
      draggable={false}
      loading="eager"
      src={AIRHOP_MARK_PATH}
      {...props}
    />
  );
}

export function AirHopWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn("inline-flex items-center gap-2 font-semibold", className)}
    >
      <AirHopMark className="size-[1.35em]" />
      <span>{AIRHOP_PRODUCT_NAME}</span>
    </span>
  );
}

export function AirHopLoadingMark({
  className,
  ariaLabel,
}: {
  className?: string;
  ariaLabel: string;
}) {
  return (
    <div
      aria-label={ariaLabel}
      className={cn("airhop-loading-mark", className)}
      data-testid="airhop-loading-mark"
      role="img"
    >
      <AirHopMark className="h-full w-full" />
    </div>
  );
}
