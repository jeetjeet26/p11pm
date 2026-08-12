"use client";

import { Activity, LoaderCircle, Search } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { CrmActivity } from "@/components/crm/types";

interface TimelineActivity extends CrmActivity {
  source?: string | null;
  projectName?: string | null;
}

export function RelationshipTimeline({
  clientId,
  initialActivities,
}: {
  clientId: string;
  initialActivities: TimelineActivity[];
}) {
  const [activities, setActivities] = useState(initialActivities);
  const [activityType, setActivityType] = useState("all");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(
    initialActivities.at(-1)?.occurredAt ?? null,
  );
  const [hasMore, setHasMore] = useState(initialActivities.length >= 100);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function load(reset: boolean) {
    setLoading(true);
    setError("");
    const parameters = new URLSearchParams({
      clientId,
      limit: "100",
    });
    if (!reset && cursor) parameters.set("before", cursor);
    if (activityType !== "all") parameters.set("type", activityType);
    if (query.trim()) parameters.set("q", query.trim());
    const response = await fetch(
      `/api/client-activities/timeline?${parameters.toString()}`,
    );
    const result = (await response.json()) as {
      activities?: Array<Record<string, unknown>>;
      hasMore?: boolean;
      nextCursor?: string | null;
      error?: string;
    };
    if (response.ok) {
      const next = (result.activities ?? []).map(mapTimelineActivity);
      setActivities((current) => (reset ? next : [...current, ...next]));
      setCursor(result.nextCursor ?? null);
      setHasMore(Boolean(result.hasMore));
    } else {
      setError(result.error ?? "Could not load the relationship timeline.");
    }
    setLoading(false);
  }

  return (
    <div className="space-y-3">
      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          void load(true);
        }}
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search relationship activity"
            value={query}
          />
        </div>
        <Select onValueChange={setActivityType} value={activityType}>
          <SelectTrigger className="sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All activity</SelectItem>
            <SelectItem value="email">Email</SelectItem>
            <SelectItem value="meeting">Meetings</SelectItem>
            <SelectItem value="call">Calls</SelectItem>
            <SelectItem value="note">Notes</SelectItem>
            <SelectItem value="report">Reports</SelectItem>
            <SelectItem value="event_log">Event log</SelectItem>
          </SelectContent>
        </Select>
        <Button disabled={loading} type="submit" variant="outline">
          {loading ? <LoaderCircle className="animate-spin" /> : <Search />}
          Filter
        </Button>
      </form>
      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      <Card className="py-0">
        <div className="divide-y">
          {activities.map((item) => (
            <div className="flex gap-3 p-4" key={item.id}>
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted">
                <Activity className="size-4 text-muted-foreground" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap justify-between gap-2">
                  <div>
                    <p className="font-medium">{item.subject}</p>
                    <p className="mt-0.5 text-xs capitalize text-muted-foreground">
                      {[item.type, item.source, item.projectName]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <time className="text-xs text-muted-foreground">
                    {formatDate(item.occurredAt)}
                  </time>
                </div>
                {item.body ? (
                  <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-muted-foreground">
                    {item.body}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Card>
      {hasMore ? (
        <Button
          disabled={loading}
          onClick={() => void load(false)}
          variant="outline"
        >
          {loading ? <LoaderCircle className="animate-spin" /> : null}
          Load older activity
        </Button>
      ) : null}
    </div>
  );
}

function mapTimelineActivity(row: Record<string, unknown>): TimelineActivity {
  return {
    id: String(row.id ?? ""),
    type: nullable(row.activity_type),
    subject: String(row.subject ?? "Activity"),
    body: nullable(row.body),
    occurredAt: String(row.occurred_at ?? ""),
    contactName: nullable(row.contact_name),
    createdByName: nullable(row.author_name),
    source: nullable(row.source),
    projectName: nullable(row.project_name),
  };
}

function nullable(value: unknown) {
  return typeof value === "string" && value ? value : null;
}

function formatDate(value: string) {
  return new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}
