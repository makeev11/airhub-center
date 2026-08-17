import * as React from "react";

import {
  createHttpStaffFamilyDirectoryService,
  type StaffFamilyDirectoryItem,
  type StaffFamilyDirectoryQuery,
  type StaffFamilyDirectoryService,
  type StaffFamilyDirectoryStatus,
} from "@/features/booking/data/staffFamilyDirectoryService";

const PAGE_SIZE = 50;

export type StaffFamilyDirectoryController = {
  status: "loading" | "ready" | "error";
  items: StaffFamilyDirectoryItem[];
  hasMore: boolean;
  isLoadingMore: boolean;
  error: Error | null;
  reload(): Promise<void>;
  loadMore(): Promise<void>;
};

type UseStaffFamilyDirectoryOptions = {
  status: StaffFamilyDirectoryStatus;
  search: string;
  service?: StaffFamilyDirectoryService;
  enabled?: boolean;
};

function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}

/** Merges cursor pages by authoritative family identity. */
export function mergeStaffFamilyDirectoryItems(
  current: StaffFamilyDirectoryItem[],
  incoming: StaffFamilyDirectoryItem[],
): StaffFamilyDirectoryItem[] {
  const byFamilyId = new Map(current.map((item) => [item.id, item] as const));
  for (const item of incoming) byFamilyId.set(item.id, item);
  return [...byFamilyId.values()];
}

/** Owns server search and pagination without consulting demo workspace state. */
export function useStaffFamilyDirectory(
  options: UseStaffFamilyDirectoryOptions,
): StaffFamilyDirectoryController {
  const service = React.useMemo(
    () => options.service ?? createHttpStaffFamilyDirectoryService(),
    [options.service],
  );
  const normalizedSearch = options.search.trim();
  const enabled = options.enabled ?? true;
  const baseQuery = React.useMemo<StaffFamilyDirectoryQuery>(
    () => ({
      status: options.status,
      search: normalizedSearch || undefined,
      limit: PAGE_SIZE,
    }),
    [normalizedSearch, options.status],
  );
  const [status, setStatus] =
    React.useState<StaffFamilyDirectoryController["status"]>("loading");
  const [items, setItems] = React.useState<StaffFamilyDirectoryItem[]>([]);
  const [nextCursor, setNextCursor] = React.useState<
    StaffFamilyDirectoryQuery["cursor"] | null
  >(null);
  const [isLoadingMore, setIsLoadingMore] = React.useState(false);
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

  const reload = React.useCallback(async (): Promise<void> => {
    const epoch = ++requestEpochRef.current;
    if (!enabled) {
      setItems([]);
      setNextCursor(null);
      setError(null);
      setStatus("ready");
      return;
    }
    setStatus("loading");
    setError(null);
    setIsLoadingMore(false);
    try {
      const page = await service.listFamilies(baseQuery);
      if (!mountedRef.current || epoch !== requestEpochRef.current) return;
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setStatus("ready");
    } catch (cause) {
      if (!mountedRef.current || epoch !== requestEpochRef.current) return;
      setItems([]);
      setNextCursor(null);
      setError(asError(cause));
      setStatus("error");
      throw cause;
    }
  }, [baseQuery, enabled, service]);

  React.useEffect(() => {
    const timeout = window.setTimeout(
      () => {
        void reload().catch(() => undefined);
      },
      enabled && normalizedSearch ? 250 : 0,
    );
    return () => window.clearTimeout(timeout);
  }, [enabled, normalizedSearch, reload]);

  const loadMore = React.useCallback(async (): Promise<void> => {
    if (!enabled || !nextCursor || isLoadingMore) return;
    const epoch = ++requestEpochRef.current;
    setIsLoadingMore(true);
    setError(null);
    try {
      const page = await service.listFamilies({
        ...baseQuery,
        cursor: nextCursor,
      });
      if (!mountedRef.current || epoch !== requestEpochRef.current) return;
      setItems((current) =>
        mergeStaffFamilyDirectoryItems(current, page.items),
      );
      setNextCursor(page.nextCursor);
      setStatus("ready");
    } catch (cause) {
      if (!mountedRef.current || epoch !== requestEpochRef.current) return;
      setError(asError(cause));
      throw cause;
    } finally {
      if (mountedRef.current && epoch === requestEpochRef.current) {
        setIsLoadingMore(false);
      }
    }
  }, [baseQuery, enabled, isLoadingMore, nextCursor, service]);

  return {
    status,
    items,
    hasMore: nextCursor !== null,
    isLoadingMore,
    error,
    reload,
    loadMore,
  };
}
