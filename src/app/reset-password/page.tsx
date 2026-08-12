import { Suspense } from "react";
import { KeyRound, Layers3 } from "lucide-react";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export const metadata = {
  title: "Set password",
};

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-4">
          <div className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground">
            <Layers3 className="size-5" />
          </div>
          <div>
            <CardTitle className="flex items-center gap-2 text-2xl">
              <KeyRound className="size-5" />
              Set your password
            </CardTitle>
            <CardDescription className="mt-2">
              Choose the password you will use to sign in to P11 PM.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Suspense fallback={<Skeleton className="h-64 w-full" />}>
            <ResetPasswordForm />
          </Suspense>
        </CardContent>
      </Card>
    </main>
  );
}
