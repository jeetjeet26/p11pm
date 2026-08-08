"use client";

import { useState } from "react";
import { CheckCircle2, LoaderCircle, Mail } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createClient } from "@/lib/supabase/client";

export function InviteForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState(
    searchParams.get("full_name") ?? "",
  );
  const [error, setError] = useState(searchParams.get("error") ?? "");
  const [complete, setComplete] = useState(false);
  const [loading, setLoading] = useState(false);

  async function acceptInvite(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    const supabase = createClient();
    if (!supabase) {
      setError("Passwordless sign-in is not configured for this environment.");
      setLoading(false);
      return;
    }

    const normalizedEmail = email.trim().toLowerCase();

    const response = await fetch("/api/auth/accept-invite", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, fullName, email: normalizedEmail }),
    });
    const body = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(body.error ?? "Could not accept this invite.");
      setLoading(false);
      return;
    }

    const callbackUrl = new URL("/auth/callback", window.location.origin);
    callbackUrl.searchParams.set("next", "/dashboard");
    callbackUrl.searchParams.set("invite_token", token);
    callbackUrl.searchParams.set("full_name", fullName.trim());
    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: normalizedEmail,
      options: {
        emailRedirectTo: callbackUrl.toString(),
        shouldCreateUser: false,
      },
    });
    if (otpError) {
      setError(otpError.message);
      setLoading(false);
      return;
    }

    setComplete(true);
    setLoading(false);
  }

  if (complete) {
    return (
      <div className="space-y-5 text-center">
        <CheckCircle2 className="mx-auto size-10 text-emerald-600" />
        <div>
          <h2 className="font-semibold">Check your work email</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Use the secure link we sent to finish claiming your invitation.
          </p>
        </div>
        <Button asChild className="w-full" variant="outline">
          <Link href="/login">Continue to sign in</Link>
        </Button>
      </div>
    );
  }

  return (
    <form className="space-y-4" onSubmit={acceptInvite}>
      {!token && (
        <Alert variant="destructive">
          <AlertDescription>
            This page needs a valid invite link from a P11 administrator.
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="space-y-2">
        <Label htmlFor="invite-email">Work email</Label>
        <Input
          autoComplete="email"
          id="invite-email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="name">Full name</Label>
        <Input
          autoComplete="name"
          id="name"
          onChange={(event) => setFullName(event.target.value)}
          required
          value={fullName}
        />
      </div>
      <Button className="w-full" disabled={!token || loading} size="lg">
        {loading ? <LoaderCircle className="animate-spin" /> : <Mail />}
        Email my invitation link
      </Button>
    </form>
  );
}
