import { AlertTriangle } from "lucide-react";

import { SupportWorkspace } from "@/components/support/support-workspace";
import { Card, CardContent } from "@/components/ui/card";
import { getSupportPageContext } from "@/lib/support/server";

export const metadata = { title: "Support" };

export default async function SupportPage() {
  const context = await getSupportPageContext();
  if (!context.canRead) {
    return (
      <Card>
        <CardContent className="flex min-h-64 flex-col items-center justify-center text-center">
          <AlertTriangle className="size-8 text-muted-foreground" />
          <h1 className="mt-3 text-xl font-semibold">Support access is required</h1>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Ask a workspace administrator for support read or agent access.
          </p>
        </CardContent>
      </Card>
    );
  }
  return (
    <SupportWorkspace
      canWrite={context.canWrite}
      clients={context.clients}
      profiles={context.profiles}
    />
  );
}
