import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";

import { safeNextPath } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

const allowedOtpTypes = new Set<EmailOtpType>([
  "email",
  "invite",
  "magiclink",
  "signup",
]);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const requestedType = url.searchParams.get("type") as EmailOtpType | null;
  const inviteToken = url.searchParams.get("invite_token");
  const fullName = url.searchParams.get("full_name");
  const next = safeNextPath(url.searchParams.get("next"));
  const supabase = await createClient();

  if (supabase) {
    const authResult = code
      ? await supabase.auth.exchangeCodeForSession(code)
      : tokenHash && requestedType && allowedOtpTypes.has(requestedType)
        ? await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: requestedType,
          })
        : { error: new Error("Missing passwordless verification details.") };

    if (!authResult.error) {
      if (inviteToken) {
        if (!fullName) {
          await supabase.auth.signOut();
          return inviteErrorRedirect(
            request,
            inviteToken,
            "Enter your full name and request a new invitation link.",
          );
        }

        const { error: claimError } = await supabase.rpc(
          "claim_workspace_invite",
          {
            invite_token: inviteToken,
            requested_full_name: fullName,
          },
        );
        if (claimError) {
          console.error("Atomic invitation claim failed:", claimError.message);
          await supabase.auth.signOut();
          return inviteErrorRedirect(
            request,
            inviteToken,
            "This invitation is invalid, expired, or belongs to another account.",
            fullName,
          );
        }
      }

      return NextResponse.redirect(new URL(next, request.url));
    }

    console.error("Passwordless verification failed:", authResult.error.message);
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("error", "This sign-in link is invalid or expired.");
  return NextResponse.redirect(loginUrl);
}

function inviteErrorRedirect(
  request: Request,
  inviteToken: string,
  message: string,
  fullName?: string,
) {
  const inviteUrl = new URL("/invite", request.url);
  inviteUrl.searchParams.set("token", inviteToken);
  inviteUrl.searchParams.set("error", message);
  if (fullName) inviteUrl.searchParams.set("full_name", fullName);
  return NextResponse.redirect(inviteUrl);
}
