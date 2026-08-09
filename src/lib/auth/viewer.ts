import "server-only";

import { cache } from "react";
import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";

export type ViewerRole = "admin" | "manager" | "member" | "viewer";

export interface ViewerContext {
  user: {
    id: string;
    email: string;
  };
  profile: {
    id: string;
    email: string;
    fullName: string;
    title: string | null;
    avatarUrl: string | null;
    status: "active";
  };
  organization: {
    id: string;
    name: string;
    slug: string;
  };
  role: ViewerRole;
}

function isViewerRole(value: unknown): value is ViewerRole {
  return (
    value === "admin" ||
    value === "manager" ||
    value === "member" ||
    value === "viewer"
  );
}

export const getViewer = cache(async (): Promise<ViewerContext | null> => {
  const supabase = await createClient();
  if (!supabase) return null;

  const requestHeaders = await headers();
  let userId = requestHeaders.get("x-p11-verified-user-id");
  if (!userId) {
    const { data: claimsData, error: claimsError } =
      await supabase.auth.getClaims();
    userId = claimsError ? null : (claimsData?.claims.sub ?? null);
  }
  if (!userId) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id,organization_id,email,full_name,title,avatar_url,role,status,organization:organizations!inner(id,name,slug)",
    )
    .eq("id", userId)
    .eq("status", "active")
    .not("organization_id", "is", null)
    .maybeSingle();

  const organization = Array.isArray(profile?.organization)
    ? profile.organization[0]
    : profile?.organization;
  if (profileError) throw profileError;
  if (
    !profile?.organization_id ||
    !isViewerRole(profile.role) ||
    !organization
  ) {
    return null;
  }

  return {
    user: {
      id: userId,
      email: profile.email,
    },
    profile: {
      id: profile.id,
      email: profile.email,
      fullName: profile.full_name,
      title: profile.title,
      avatarUrl: profile.avatar_url,
      status: "active",
    },
    organization,
    role: profile.role,
  };
});
