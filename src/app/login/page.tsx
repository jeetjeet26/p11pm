import { Suspense } from "react";
import { Building2, CheckCircle2, Layers3 } from "lucide-react";

import { LoginForm } from "@/components/auth/login-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { isDemoModeAllowed } from "@/lib/demo-mode";
import { isSupabaseConfigured } from "@/lib/supabase/config";

export const metadata = {
  title: "Sign in",
};

export default function LoginPage() {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_0.9fr]">
      <section className="relative hidden overflow-hidden bg-sidebar px-12 py-14 text-sidebar-foreground lg:flex lg:flex-col">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_20%,oklch(0.67_0.14_237/0.2),transparent_42%)]" />
        <div className="relative flex items-center gap-3">
          <div className="grid size-10 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground">
            <Layers3 className="size-5" />
          </div>
          <div>
            <p className="text-lg font-semibold tracking-tight">P11 PM</p>
            <p className="text-xs text-sidebar-foreground/60">Creative operations, connected.</p>
          </div>
        </div>

        <div className="relative my-auto max-w-xl">
          <p className="mb-5 text-sm font-medium uppercase tracking-[0.18em] text-sidebar-primary">
            One operating view
          </p>
          <h1 className="text-balance text-5xl font-semibold leading-[1.08] tracking-tight">
            Know what the team is shipping, without chasing updates.
          </h1>
          <div className="mt-10 grid gap-4 text-sm text-sidebar-foreground/75">
            {[
              "Client work mapped into clear project spaces",
              "Executive workload and due-date visibility",
              "Slack and Claude Cowork built into the workflow",
            ].map((item) => (
              <div className="flex items-center gap-3" key={item}>
                <CheckCircle2 className="size-4 text-sidebar-primary" />
                {item}
              </div>
            ))}
          </div>
        </div>

        <p className="relative text-xs text-sidebar-foreground/45">
          Built for P11 Creative’s digital, print, and real-estate marketing teams.
        </p>
      </section>

      <section className="flex items-center justify-center px-6 py-12">
        <Card className="w-full max-w-md border-0 shadow-none sm:border sm:shadow-sm">
          <CardHeader className="space-y-4 pb-6">
            <div className="grid size-11 place-items-center rounded-xl bg-primary text-primary-foreground lg:hidden">
              <Building2 className="size-5" />
            </div>
            <div>
              <CardTitle className="text-2xl">Welcome back</CardTitle>
              <CardDescription className="mt-2">
                Sign in with your work email and password.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <Suspense fallback={<Skeleton className="h-80 w-full" />}>
              <LoginForm
                demoModeAllowed={isDemoModeAllowed()}
                supabaseConfigured={isSupabaseConfigured}
              />
            </Suspense>
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Need access? Ask a P11 administrator for an invite.
            </p>
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
