import { ChevronDown } from "lucide-react";
import * as React from "react";

import { cn } from "@/shared/lib/cn";

type BookingSelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & {
  wrapperClassName?: string;
};

export const BookingSelect = React.forwardRef<
  HTMLSelectElement,
  BookingSelectProps
>(({ children, className, wrapperClassName, ...props }, ref) => (
  <span className={cn("relative inline-block min-w-0", wrapperClassName)}>
    <select
      className={cn(
        "peer h-9 w-full appearance-none rounded-lg border border-input/40 bg-background py-0 pr-9 pl-3 text-sm outline-hidden focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      ref={ref}
      {...props}
    >
      {children}
    </select>
    <ChevronDown
      aria-hidden="true"
      className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground peer-disabled:opacity-50"
    />
  </span>
));

BookingSelect.displayName = "BookingSelect";
