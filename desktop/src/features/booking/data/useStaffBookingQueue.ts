import * as React from "react";

import {
  createHttpStaffBookingDecisionService,
  type StaffBookingDecision,
  type StaffBookingDecisionOutcome,
  type StaffBookingDecisionService,
} from "@/features/booking/data/staffBookingDecisionService";
import {
  createHttpStaffBookingQueueService,
  type StaffBookingQueueItem,
  type StaffBookingQueueQuery,
  type StaffBookingQueueService,
} from "@/features/booking/data/staffBookingQueueService";

const PAGE_SIZE = 50;

export type StaffBookingQueueView =
  | "all"
  | "attention"
  | "pending"
  | "confirmed"
  | "processed";

export type StaffBookingQueueState = {
  status: "idle" | "loading" | "ready" | "error";
  items: StaffBookingQueueItem[];
  view: StaffBookingQueueView;
  hasMore: boolean;
  isLoadingMore: boolean;
  isDeciding: boolean;
  error: Error | null;
};

type UseStaffBookingQueueOptions = {
  enabled?: boolean;
  queueService?: StaffBookingQueueService;
  decisionService?: StaffBookingDecisionService;
};

export type StaffBookingQueueController = StaffBookingQueueState & {
  setView(view: StaffBookingQueueView): void;
  reload(): Promise<void>;
  loadMore(): Promise<void>;
  decideBooking(input: {
    bookingId: string;
    decision: StaffBookingDecision;
  }): Promise<StaffBookingDecisionOutcome>;
};

/** Converts a screen view into the strongest filter supported by Booking Core. */
export function staffBookingQueueQueryForView(
  view: StaffBookingQueueView,
): StaffBookingQueueQuery {
  switch (view) {
    case "pending":
      return { status: "pending_confirmation", limit: PAGE_SIZE };
    case "confirmed":
      return { status: "confirmed", limit: PAGE_SIZE };
    case "attention":
      return { attentionOnly: true, limit: PAGE_SIZE };
    case "processed":
    case "all":
      return { limit: PAGE_SIZE };
  }
}

/** Applies the part of a queue view that cannot yet be expressed by the API. */
export function staffBookingQueueItemMatchesView(
  item: StaffBookingQueueItem,
  view: StaffBookingQueueView,
): boolean {
  if (view === "processed") {
    return !["pending_confirmation", "confirmed"].includes(item.booking.status);
  }
  return true;
}

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Merges a cursor page by authoritative booking identity. */
export function mergeStaffBookingQueueItems(
  current: StaffBookingQueueItem[],
  incoming: StaffBookingQueueItem[],
): StaffBookingQueueItem[] {
  const byBookingId = new Map(
    current.map((item) => [item.booking.id, item] as const),
  );
  for (const item of incoming) byBookingId.set(item.booking.id, item);
  return [...byBookingId.values()];
}

/**
 * Executes a command and requests a fresh read model. A refresh failure does
 * not turn an accepted command into a retryable failure.
 */
export async function executeStaffBookingDecision(input: {
  decisionService: StaffBookingDecisionService;
  reload: () => Promise<void>;
  bookingId: string;
  decision: StaffBookingDecision;
}): Promise<StaffBookingDecisionOutcome> {
  const outcome = await input.decisionService.decideBooking({
    bookingId: input.bookingId,
    decision: input.decision,
  });
  try {
    await input.reload();
  } catch {
    // The caller's reload path owns and exposes the projection error.
  }
  return outcome;
}

/**
 * Owns the server-backed staff queue lifecycle. It never reads or writes the
 * demo workspace, and refreshes the authoritative read model after commands.
 */
export function useStaffBookingQueue(
  options: UseStaffBookingQueueOptions = {},
): StaffBookingQueueController {
  const enabled = options.enabled ?? true;
  const queueService = React.useMemo(
    () => options.queueService ?? createHttpStaffBookingQueueService(),
    [options.queueService],
  );
  const decisionService = React.useMemo(
    () => options.decisionService ?? createHttpStaffBookingDecisionService(),
    [options.decisionService],
  );
  const [view, setView] = React.useState<StaffBookingQueueView>("pending");
  const [loadedView, setLoadedView] =
    React.useState<StaffBookingQueueView | null>(null);
  const [status, setStatus] =
    React.useState<StaffBookingQueueState["status"]>("idle");
  const [items, setItems] = React.useState<StaffBookingQueueItem[]>([]);
  const [nextCursor, setNextCursor] = React.useState<
    StaffBookingQueueQuery["cursor"] | null
  >(null);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
  const [isDeciding, setIsDeciding] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);
  const mountedRef = React.useRef(false);
  const requestEpochRef = React.useRef(0);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestEpochRef.current += 1;
    };
  }, []);

  const loadHead = React.useCallback(async (): Promise<void> => {
    if (!enabled) return;
    const requestEpoch = ++requestEpochRef.current;
    setStatus("loading");
    setError(null);
    setIsLoadingMore(false);
    try {
      const page = await queueService.listBookingRequests(
        staffBookingQueueQueryForView(view),
      );
      if (!mountedRef.current || requestEpoch !== requestEpochRef.current) {
        return;
      }
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setLoadedView(view);
      setStatus("ready");
    } catch (cause) {
      if (!mountedRef.current || requestEpoch !== requestEpochRef.current) {
        return;
      }
      setError(asError(cause));
      setStatus("error");
      throw cause;
    }
  }, [enabled, queueService, view]);

  React.useEffect(() => {
    if (!enabled) {
      setStatus("idle");
      setItems([]);
      setNextCursor(null);
      setLoadedView(null);
      setError(null);
      return;
    }
    void loadHead().catch(() => undefined);
  }, [enabled, loadHead]);

  const loadMore = React.useCallback(async (): Promise<void> => {
    if (!enabled || !nextCursor || isLoadingMore) return;
    const requestEpoch = ++requestEpochRef.current;
    setIsLoadingMore(true);
    setError(null);
    try {
      const page = await queueService.listBookingRequests({
        ...staffBookingQueueQueryForView(view),
        cursor: nextCursor,
      });
      if (!mountedRef.current || requestEpoch !== requestEpochRef.current) {
        return;
      }
      setItems((current) => mergeStaffBookingQueueItems(current, page.items));
      setNextCursor(page.nextCursor);
      setStatus("ready");
    } catch (cause) {
      if (!mountedRef.current || requestEpoch !== requestEpochRef.current) {
        return;
      }
      setError(asError(cause));
      throw cause;
    } finally {
      if (mountedRef.current && requestEpoch === requestEpochRef.current) {
        setIsLoadingMore(false);
      }
    }
  }, [enabled, isLoadingMore, nextCursor, queueService, view]);

  const decideBooking = React.useCallback(
    async (input: {
      bookingId: string;
      decision: StaffBookingDecision;
    }): Promise<StaffBookingDecisionOutcome> => {
      setIsDeciding(true);
      setError(null);
      try {
        return await executeStaffBookingDecision({
          decisionService,
          reload: loadHead,
          ...input,
        });
      } catch (cause) {
        if (mountedRef.current) setError(asError(cause));
        throw cause;
      } finally {
        if (mountedRef.current) setIsDeciding(false);
      }
    },
    [decisionService, loadHead],
  );

  return {
    status,
    items:
      loadedView === view
        ? items.filter((item) => staffBookingQueueItemMatchesView(item, view))
        : [],
    view,
    hasMore: loadedView === view && nextCursor !== null,
    isLoadingMore,
    isDeciding,
    error,
    setView,
    reload: loadHead,
    loadMore,
    decideBooking,
  };
}
