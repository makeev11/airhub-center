import type * as React from "react";

import type { PublicBookingAppearance } from "@/features/booking/model/bookingCore";
import { cn } from "@/shared/lib/cn";

type PublicBookingThemeStyle = React.CSSProperties &
  Record<`--${string}`, string>;

const LIGHT_STYLE: PublicBookingThemeStyle = {
  colorScheme: "light",
  "--background": "220 23.08% 94.9%",
  "--foreground": "234 16.02% 35.49%",
  "--card": "0 0% 100%",
  "--card-foreground": "234 16.02% 35.49%",
  "--popover": "0 0% 100%",
  "--popover-foreground": "234 16.02% 35.49%",
  "--primary": "266 85.05% 58.04%",
  "--primary-foreground": "0 0% 100%",
  "--secondary": "223 15.91% 82.75%",
  "--secondary-foreground": "234 16.02% 35.49%",
  "--muted": "223 15.91% 87%",
  "--muted-foreground": "233 12.8% 41.37%",
  "--accent": "223 15.91% 82.75%",
  "--accent-foreground": "234 16.02% 35.49%",
  "--destructive": "347 86.67% 44.12%",
  "--destructive-foreground": "0 0% 100%",
  "--border": "225 13.56% 76.86%",
  "--input": "225 13.56% 76.86%",
  "--ring": "266 85.05% 58.04%",
};

const DARK_STYLE: PublicBookingThemeStyle = {
  colorScheme: "dark",
  "--background": "232 23.4% 18.43%",
  "--foreground": "227 68.25% 87.65%",
  "--card": "230 18.8% 22%",
  "--card-foreground": "227 68.25% 87.65%",
  "--popover": "230 18.8% 22%",
  "--popover-foreground": "227 68.25% 87.65%",
  "--primary": "267 82.69% 79.61%",
  "--primary-foreground": "232 23.4% 18.43%",
  "--secondary": "230 18.8% 26.08%",
  "--secondary-foreground": "227 68.25% 87.65%",
  "--muted": "230 18.8% 26.08%",
  "--muted-foreground": "228 39.22% 80%",
  "--accent": "230 18.8% 26.08%",
  "--accent-foreground": "227 68.25% 87.65%",
  "--destructive": "351 73.91% 72.94%",
  "--destructive-foreground": "232 23.4% 18.43%",
  "--border": "231 15.61% 33.92%",
  "--input": "231 15.61% 33.92%",
  "--ring": "267 82.69% 79.61%",
};

export function PublicBookingShell({
  appearance = "automatic",
  children,
  mode,
  testId,
}: {
  appearance?: PublicBookingAppearance;
  children: React.ReactNode;
  mode: "standalone" | "embedded";
  testId?: string;
}) {
  return (
    <div
      className={cn(
        "relative isolate overflow-hidden bg-background text-foreground",
        mode === "standalone" ? "h-dvh min-h-0" : "h-full min-h-0 rounded-3xl",
      )}
      data-airhop-appearance={appearance}
      data-testid={testId ?? `airhop-public-${mode}`}
      style={
        appearance === "light"
          ? LIGHT_STYLE
          : appearance === "dark"
            ? DARK_STYLE
            : undefined
      }
    >
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-72 bg-[radial-gradient(circle_at_20%_20%,color-mix(in_oklab,var(--primary)_18%,transparent),transparent_48%),radial-gradient(circle_at_80%_0%,color-mix(in_oklab,var(--accent)_45%,transparent),transparent_42%)]"
      />
      <div
        className={cn(
          "mx-auto flex w-full max-w-5xl flex-col",
          mode === "standalone"
            ? "h-dvh min-h-0 px-4 py-6 sm:px-8 sm:py-10"
            : "h-full min-h-0 max-h-[calc(100dvh-2rem)] px-4 py-4 sm:px-7 sm:py-7",
        )}
      >
        {children}
      </div>
    </div>
  );
}
