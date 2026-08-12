import { Skeleton } from "@/components/ui/skeleton";

export default function RetainersLoading() {
  return (
    <div aria-busy="true" aria-label="Loading retainers" className="space-y-7">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-3">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton className="h-20" key={index} />
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton className="h-48" key={index} />
        ))}
      </div>
      <span className="sr-only">Loading retainer agreements…</span>
    </div>
  );
}
