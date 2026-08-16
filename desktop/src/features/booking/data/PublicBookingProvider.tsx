import * as React from "react";

import type { PublicBookingService } from "@/features/booking/data/publicBookingService";

const PublicBookingContext = React.createContext<
  PublicBookingService | undefined
>(undefined);

export function PublicBookingProvider({
  children,
  service,
}: {
  children: React.ReactNode;
  service: PublicBookingService;
}) {
  return (
    <PublicBookingContext.Provider value={service}>
      {children}
    </PublicBookingContext.Provider>
  );
}

export function usePublicBookingService(): PublicBookingService {
  const service = React.useContext(PublicBookingContext);
  if (!service) {
    throw new Error(
      "usePublicBookingService must be used inside PublicBookingProvider",
    );
  }
  return service;
}
