import { Skeleton } from "@/components/ui/skeleton";

export default function TeamLoading() {
  return (
    <div aria-busy="true" aria-label="Loading team view" className="space-y-7">
      <div className="space-y-3">
        <Skeleton className="h-9 w-56" />
        <Skeleton className="h-5 w-96 max-w-full" />
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton className="h-20" key={index} />
        ))}
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, index) => (
          <Skeleton className="h-20 w-full" key={index} />
        ))}
      </div>
      <span className="sr-only">Loading team workload…</span>
    </div>
  );
}
