import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export interface SupabaseServerConfig {
  url: string;
  serviceRoleKey: string;
}

export function getAppSupabaseConfig(): SupabaseServerConfig | null {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    return null;
  }

  return { url, serviceRoleKey };
}

export function createServerSupabaseClient(
  config: SupabaseServerConfig,
): SupabaseClient {
  return createClient(config.url, config.serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
    global: {
      headers: {
        "X-Client-Info": "p11-pm-server",
      },
    },
  });
}

export function getAppSupabaseClient(): SupabaseClient | null {
  const config = getAppSupabaseConfig();
  return config ? createServerSupabaseClient(config) : null;
}
