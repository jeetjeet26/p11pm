import { Bookmark } from "lucide-react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { createClient } from "@/lib/supabase/server";

export const metadata = { title: "Saved items" };

export default async function SavedItemsPage() {
  const client = await createClient();
  const {
    data: { user },
  } = client ? await client.auth.getUser() : { data: { user: null } };
  const { data } =
    client && user
      ? await client
          .from("saved_workspace_items")
          .select("*")
          .eq("owner_id", user.id)
          .order("created_at", { ascending: false })
          .limit(250)
      : { data: [] };
  const items = data ?? [];

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Saved items</h1>
        <p className="mt-2 text-muted-foreground">
          Personal references from conversations, files, folders, and project work.
        </p>
      </header>
      <Card className="gap-0 py-0">
        <CardContent className="divide-y p-0">
          {items.map((item) => (
            <div
              className="flex flex-col justify-between gap-3 px-5 py-4 sm:flex-row sm:items-center"
              key={item.id}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Bookmark className="size-4 text-muted-foreground" />
                  <p className="truncate font-medium">{item.title}</p>
                  <Badge variant="secondary">
                    {item.source_type.replaceAll("_", " ")}
                  </Badge>
                </div>
                {item.note && (
                  <p className="mt-1 text-sm text-muted-foreground">{item.note}</p>
                )}
              </div>
              <Button asChild size="sm" variant="outline">
                <Link href={item.href}>Open</Link>
              </Button>
            </div>
          ))}
          {!items.length && (
            <div className="p-12 text-center">
              <Bookmark className="mx-auto size-8 text-muted-foreground" />
              <p className="mt-3 font-medium">Nothing saved yet</p>
              <p className="mt-1 text-sm text-muted-foreground">
                Save important messages, files, and folders so they remain easy to find.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
