"use client";

import { useState } from "react";
import { LoaderCircle, LogIn } from "lucide-react";
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
  const initialNotice = searchParams.get("notice");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [notice, setNotice] = useState(initialNotice ?? "");
  const [loading, setLoading] = useState(false);

  async function signIn(event: React.FormEvent) {
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

    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });

    if (signInError) {
      setError("The email or password is incorrect.");
      setLoading(false);
      return;
    }

    router.push(next);
    router.refresh();
  }

  async function sendPasswordReset() {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      setError("Enter your work email first.");
      return;
    }

    setLoading(true);
    setError("");
    setNotice("");
    const supabase = createClient();
    if (!supabase) {
      setError("Supabase is not configured yet. Use the demo workspace.");
      setLoading(false);
      return;
    }

    const resetPage = `/reset-password?next=${encodeURIComponent(next)}`;
    const redirectTo = new URL("/auth/callback", window.location.origin);
    redirectTo.searchParams.set("next", resetPage);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      normalizedEmail,
      { redirectTo: redirectTo.toString() },
    );

    if (resetError) setError(resetError.message);
    else setNotice("Check your inbox for a password reset link.");
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

      <form className="space-y-4" onSubmit={signIn}>
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
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-4">
            <Label htmlFor="password">Password</Label>
            <button
              className="text-xs font-medium text-primary hover:underline"
              disabled={loading || !supabaseConfigured}
              onClick={sendPasswordReset}
              type="button"
            >
              Forgot password?
            </button>
          </div>
          <Input
            autoComplete="current-password"
            id="password"
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </div>
        <Button
          className="w-full"
          disabled={loading || !supabaseConfigured}
          size="lg"
          type="submit"
        >
          {loading ? <LoaderCircle className="animate-spin" /> : <LogIn />}
          Sign in
        </Button>
      </form>

      <div className="grid gap-2">
        {!supabaseConfigured ? (
          <p className="text-center text-xs text-muted-foreground">
            Password sign-in is not configured for this environment.
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
