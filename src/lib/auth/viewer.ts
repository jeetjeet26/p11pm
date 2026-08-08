import "server-only";

import { cache } from "react";
import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/supabase/server";

export type ViewerRole = "admin" | "manager" | "member" | "viewer";

export interface ViewerContext {
  user: User;
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

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();
  if (userError || !user?.email) return null;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id,organization_id,email,full_name,title,avatar_url,role,status",
    )
    .eq("id", user.id)
    .eq("status", "active")
    .not("organization_id", "is", null)
    .maybeSingle();

  if (profileError) throw profileError;
  if (
    !profile?.organization_id ||
    profile.email.toLowerCase() !== user.email.toLowerCase() ||
    !isViewerRole(profile.role)
  ) {
    return null;
  }

  const { data: organization, error: organizationError } = await supabase
    .from("organizations")
    .select("id,name,slug")
    .eq("id", profile.organization_id)
    .maybeSingle();

  if (organizationError) throw organizationError;
  if (!organization) return null;

  return {
    user,
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
