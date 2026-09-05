import { useEffect, type Dispatch, type SetStateAction } from "react";

import type {
  PublicBookingManagementCard,
  PublicBookingService,
} from "@/features/booking/data/publicBookingService";

type BookingSuccess = {
  token: string | null;
  card: PublicBookingManagementCard;
} | null;

export function useBookingHandoffStatus(
  service: PublicBookingService,
  success: BookingSuccess,
  setSuccess: Dispatch<SetStateAction<BookingSuccess>>,
) {
  const token = success?.token;
  const expiresAt = success?.card.messengerHandoff?.expiresAt;
  const connected = success?.card.telegramConnected;
  const status = success?.card.status;
  useEffect(() => {
    if (
      !token ||
      !expiresAt ||
      (connected && status !== "pending_confirmation")
    )
      return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      if (stopped) return;
      if (Date.now() >= Date.parse(expiresAt)) {
        setSuccess((current) =>
          current?.token === token &&
          current.card.messengerHandoff?.expiresAt === expiresAt
            ? {
                ...current,
                card: { ...current.card, messengerHandoff: undefined },
              }
            : current,
        );
        return;
      }
      try {
        const card = await service.getManagementCard(token);
        if (!stopped && card)
          setSuccess((current) =>
            current?.token === token &&
            current.card.messengerHandoff?.expiresAt === expiresAt
              ? {
                  ...current,
                  card: {
                    ...card,
                    messengerHandoff: current.card.messengerHandoff,
                  },
                }
              : current,
          );
        // Binding and confirmation are different commits. Keep reading until
        // the authoritative decision, not just until the messenger connects.
        if (card?.telegramConnected && card.status !== "pending_confirmation")
          return;
      } catch {
        /* A temporary read failure does not invalidate the issued link. */
      }
      if (!stopped) timer = setTimeout(refresh, 5000);
    };
    timer = setTimeout(refresh, 2000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [token, expiresAt, connected, status, service, setSuccess]);
}
