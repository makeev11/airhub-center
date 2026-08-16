import { RouterProvider } from "@tanstack/react-router";
import * as React from "react";

import { router } from "@/app/router";
import { PublicBookingProvider } from "@/features/booking/data/PublicBookingProvider";
import { createDemoPublicBookingService } from "@/features/booking/data/demoPublicBookingService";
import { createHttpPublicBookingService } from "@/features/booking/data/httpPublicBookingService";
import type { PublicBookingService } from "@/features/booking/data/publicBookingService";
import { isAirhopDemoRuntimeAvailable } from "@/features/booking/lib/demoRuntime";
import { getPublicBookingMessages } from "@/features/booking/lib/publicBookingLocale";

function createPublicBookingService(): PublicBookingService | null {
  const runtime = (
    import.meta.env as { VITE_AIRHOP_PUBLIC_BOOKING_RUNTIME?: string }
  ).VITE_AIRHOP_PUBLIC_BOOKING_RUNTIME;
  if (runtime === "server" || !isAirhopDemoRuntimeAvailable) {
    return createHttpPublicBookingService();
  }
  return createDemoPublicBookingService();
}

export function PublicBookingApp() {
  const [service] = React.useState(createPublicBookingService);
  if (!service) {
    const messages = getPublicBookingMessages("ru-RU");
    return (
      <main className="flex min-h-dvh items-center justify-center bg-background p-6 text-foreground">
        <div className="max-w-md rounded-3xl border border-border/70 bg-card p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold">{messages.unavailableTitle}</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            {messages.unavailableDescription}
          </p>
        </div>
      </main>
    );
  }
  return (
    <PublicBookingProvider service={service}>
      <RouterProvider router={router} />
    </PublicBookingProvider>
  );
}
