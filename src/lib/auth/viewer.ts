import "server-only";

import { cache } from "react";

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

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;
  const email = typeof claims?.email === "string" ? claims.email : null;
  if (claimsError || !claims?.sub || !email) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id,organization_id,email,full_name,title,avatar_url,role,status,organization:organizations!inner(id,name,slug)",
    )
    .eq("id", claims.sub)
    .eq("status", "active")
    .not("organization_id", "is", null)
    .maybeSingle();

  const organization = Array.isArray(profile?.organization)
    ? profile.organization[0]
    : profile?.organization;
  if (profileError) throw profileError;
  if (
    !profile?.organization_id ||
    profile.email.toLowerCase() !== email.toLowerCase() ||
    !isViewerRole(profile.role) ||
    !organization
  ) {
    return null;
  }

  return {
    user: {
      id: claims.sub,
      email,
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
