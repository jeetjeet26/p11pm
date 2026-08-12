import { Skeleton } from "@/components/ui/skeleton";

export default function ClientsLoading() {
  return (
    <div aria-busy="true" aria-label="Loading clients" className="space-y-7">
      <div className="flex items-end justify-between gap-4">
        <div className="space-y-3">
          <Skeleton className="h-9 w-48" />
          <Skeleton className="h-5 w-96 max-w-full" />
        </div>
        <Skeleton className="h-8 w-28" />
      </div>
      <Skeleton className="h-16 w-full" />
      <Skeleton className="h-96 w-full" />
      <span className="sr-only">Loading client directory…</span>
    </div>
  );
}
