import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function TimeLoading() {
  return (
    <div aria-busy="true" aria-label="Loading timesheet" className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-9 w-32" />
        <Skeleton className="h-5 w-80 max-w-full" />
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {[0, 1, 2].map((item) => (
          <Card key={item}>
            <CardContent className="space-y-3">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-8 w-32" />
            </CardContent>
          </Card>
        ))}
      </div>
      <Card>
        <CardContent className="space-y-4">
          {[0, 1, 2, 3].map((item) => <Skeleton className="h-12 w-full" key={item} />)}
        </CardContent>
      </Card>
      <span className="sr-only">Loading timesheet…</span>
    </div>
  );
}
