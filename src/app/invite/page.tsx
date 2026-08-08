import { Suspense } from "react";
import { Layers3 } from "lucide-react";

import { InviteForm } from "@/components/auth/invite-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = {
  title: "Accept invite",
};

export default function InvitePage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <div className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Layers3 className="size-5" />
          </div>
          <div>
            <CardTitle className="text-2xl">Join the P11 workspace</CardTitle>
            <CardDescription className="mt-2">
              Finish setting up your invite-only internal account.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-72 w-full" />}>
            <InviteForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
