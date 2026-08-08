"use client";

import { useState } from "react";
import { LoaderCircle, Mail } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/client";

export function LoginForm({
  demoModeAllowed,
  supabaseConfigured,
}: {
  demoModeAllowed: boolean;
  supabaseConfigured: boolean;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNextPath(searchParams.get("next"));
  const initialError = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [notice, setNotice] = useState("");
  const [loading, setLoading] = useState(false);

  async function sendMagicLink(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    setNotice("");
    const supabase = createClient();

    if (!supabase) {
      setError("Supabase is not configured yet. Use the demo workspace.");
      setLoading(false);
      return;
    }

    const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`;
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { emailRedirectTo: redirectTo, shouldCreateUser: false },
    });

    if (otpError) setError(otpError.message);
    else setNotice("Check your inbox for a secure sign-in link.");
    setLoading(false);
  }

  async function enterDemo() {
    setLoading(true);
    setError("");
    const response = await fetch(
      `/api/auth/demo?next=${encodeURIComponent(next)}`,
      { method: "POST" },
    );
    const body = (await response.json()) as { next?: string; error?: string };
    if (!response.ok) {
      setError(body.error ?? "Demo mode is unavailable.");
      setLoading(false);
      return;
    }
    router.push(body.next ?? "/dashboard");
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {(error || notice) && (
        <Alert variant={error ? "destructive" : "default"}>
          <AlertDescription>{error || notice}</AlertDescription>
        </Alert>
      )}

      <form className="space-y-4" onSubmit={sendMagicLink}>
        <div className="space-y-2">
          <Label htmlFor="email">Work email</Label>
          <Input
            autoComplete="email"
            id="email"
            onChange={(event) => setEmail(event.target.value)}
            placeholder="you@p11creative.com"
            required
            type="email"
            value={email}
          />
        </div>
        <Button
          className="w-full"
          disabled={loading || !supabaseConfigured}
          size="lg"
          type="submit"
        >
          {loading ? <LoaderCircle className="animate-spin" /> : <Mail />}
          Email me a secure sign-in link
        </Button>
      </form>

      <div className="grid gap-2">
        {!supabaseConfigured ? (
          <p className="text-center text-xs text-muted-foreground">
            Passwordless sign-in is not configured for this environment.
          </p>
        ) : null}
        {demoModeAllowed ? (
          <Button disabled={loading} onClick={enterDemo} type="button" variant="secondary">
            Preview demo workspace
          </Button>
        ) : null}
      </div>
    </div>
  );
}
