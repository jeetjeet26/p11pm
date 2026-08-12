import "server-only";

import { getViewer } from "@/lib/auth/viewer";
import { createClient } from "@/lib/supabase/server";

export async function getSupportPageContext() {
  const viewer = await getViewer();
  if (!viewer?.capabilities.supportRead) {
    return {
      viewer,
      canRead: false,
      canWrite: false,
      profiles: [],
      clients: [],
    };
  }
  const client = await createClient();
  const [profiles, clients] = client
    ? await Promise.all([
        client
          .from("profiles")
          .select("id,full_name,email")
          .eq("organization_id", viewer.organization.id)
          .eq("status", "active")
          .order("full_name")
          .limit(500),
        client
          .from("clients")
          .select("id,name")
          .eq("organization_id", viewer.organization.id)
          .order("name")
          .limit(2_000),
      ])
    : [{ data: [] }, { data: [] }];
  return {
    viewer,
    canRead: true,
    canWrite: viewer.capabilities.supportWrite,
    profiles: (profiles.data ?? []).map((profile) => ({
      id: profile.id,
      name: profile.full_name || profile.email,
    })),
    clients: clients.data ?? [],
  };
}
