import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClientInboxService } from "./clientInboxService";

/** Batch only mounted roots, including old history; state resets with channel queries. */
export function useClientChannel(
  channelId?: string | null,
  rootId?: string | null,
) {
  const cache = useQueryClient();
  const [service] = React.useState(() => new ClientInboxService());
  const key = React.useMemo(
    () => ["channels", channelId, "visible-client-roots"],
    [channelId],
  );
  const registered = useQuery<Record<string, number>>({
    queryKey: key,
    queryFn: () => ({}),
    enabled: false,
    initialData: {},
  });
  React.useEffect(() => {
    if (!channelId || !rootId || !/^[0-9a-f]{64}$/i.test(rootId)) return;
    const root = rootId.toLowerCase();
    const change = (delta: number) =>
      cache.setQueryData<Record<string, number>>(key, (previous) => {
        const next = { ...previous };
        next[root] = Math.max(0, (next[root] ?? 0) + delta);
        if (!next[root]) delete next[root];
        return next;
      });
    change(1);
    return () => {
      change(-1);
    };
  }, [cache, key, channelId, rootId]);
  const requested = Object.keys(registered.data).sort().join(",");
  const [roots, setRoots] = React.useState("");
  React.useEffect(() => {
    const timer = setTimeout(() => setRoots(requested), 50);
    return () => clearTimeout(timer);
  }, [requested]);
  return useQuery({
    queryKey: ["channels", channelId, "client-presentation", roots],
    enabled: Boolean(channelId && roots),
    queryFn: async () => {
      const ids = roots.split(",");
      const pages = [];
      // Each request is bounded; serial batches avoid a burst during history expansion.
      for (let offset = 0; offset < ids.length; offset += 100) {
        pages.push(
          await service.load({
            channelId: channelId ?? "",
            rootIds: ids.slice(offset, offset + 100).join(","),
          }),
        );
      }
      return { ...pages[0], items: pages.flatMap((page) => page.items) };
    },
    staleTime: 15_000,
    gcTime: 60_000,
    refetchInterval: 30_000,
    retry: false,
  });
}
