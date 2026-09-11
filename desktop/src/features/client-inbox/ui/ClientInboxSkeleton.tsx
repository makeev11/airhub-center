import { Skeleton } from "@/shared/ui/skeleton";

/** Match the Inbox content layout while its first response is loading. */
export function ClientInboxSkeleton() {
  return (
    <div className="space-y-5" data-testid="client-inbox-skeleton">
      <div className="space-y-2">
        <Skeleton className="h-4 w-full max-w-3xl" />
        <Skeleton className="h-4 w-2/3 max-w-xl" />
      </div>
      <div className="flex flex-wrap gap-3">
        <Skeleton className="h-9 min-w-56 flex-1" />
        {[0, 1, 2].map((key) => (
          <Skeleton className="h-9 w-40" key={key} />
        ))}
      </div>
      <div className="space-y-3">
        {[0, 1, 2].map((key) => (
          <div className="space-y-3 rounded-xl border p-4" key={key}>
            <div className="flex items-center justify-between gap-4">
              <Skeleton className="h-5 w-56 max-w-full" />
              <Skeleton className="h-8 w-28 shrink-0" />
            </div>
            <Skeleton className="h-3 w-2/3" />
            <Skeleton className="h-4 w-3/4" />
            <div className="flex flex-wrap gap-3 pt-1">
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-9 w-40" />
              <Skeleton className="h-9 w-32" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
