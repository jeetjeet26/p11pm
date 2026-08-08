import { Activity, MessageSquareText, Pencil, Upload } from "lucide-react";
import Link from "next/link";

import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { getActivityPageData } from "@/lib/data";

export const metadata = { title: "Latest activity" };

const activityIcons = {
  posted: MessageSquareText,
  uploaded: Upload,
  updated: Pencil,
  started: Activity,
};

export default async function ActivityPage() {
  const data = await getActivityPageData();
  return (
    <div className="space-y-7">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Latest activity</h1>
        <p className="mt-2 text-muted-foreground">
          A chronological record of changes across active P11 work.
        </p>
      </header>
      <Card>
        <CardContent className="divide-y p-0">
          {data.activity.map((event) => {
            const Icon = activityIcons[event.verb as keyof typeof activityIcons] ?? Activity;
            return (
              <div className="flex gap-4 px-5 py-5" key={event.id}>
                <Avatar className="size-9"><AvatarFallback className="text-[10px]">{event.actorInitials}</AvatarFallback></Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm">
                    <span className="font-medium">{event.actorName}</span>{" "}
                    <span className="text-muted-foreground">{event.verb}</span>{" "}
                    <span className="font-medium">{event.object}</span>
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <Badge asChild variant="secondary"><Link href={`/projects/${event.projectId}`}>{event.projectName}</Link></Badge>
                    <span>{formatTimestamp(event.createdAt)}</span>
                  </div>
                </div>
                <div className="grid size-8 place-items-center rounded-lg bg-muted text-muted-foreground"><Icon className="size-4" /></div>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function formatTimestamp(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
