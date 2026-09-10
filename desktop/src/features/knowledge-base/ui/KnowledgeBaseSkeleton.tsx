import { Skeleton } from "@/shared/ui/skeleton";

/** Reserve the knowledge overview and material list during the initial load. */
export function KnowledgeBaseSkeleton() {
  return (
    <div className="space-y-6" data-testid="knowledge-base-skeleton">
      <div className="space-y-5 rounded-xl border bg-card p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <Skeleton className="size-12 shrink-0 rounded-xl" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {[0, 1, 2].map((key) => (
            <Skeleton className="h-9 w-44" key={key} />
          ))}
        </div>
      </div>
      <Skeleton className="h-10 w-full rounded-xl" />
      <div className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-9 w-56" />
        </div>
        {[0, 1, 2].map((key) => (
          <div className="space-y-3 rounded-xl border p-4" key={key}>
            <Skeleton className="h-5 w-2/3" />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-5 w-28" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
