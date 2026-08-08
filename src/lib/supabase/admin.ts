import "server-only";

import { createClient } from "@supabase/supabase-js";

import {
  isSupabaseAdminConfigured,
  supabaseUrl,
} from "@/lib/supabase/config";

export function createAdminClient() {
  if (
    !isSupabaseAdminConfigured ||
    !supabaseUrl ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return null;
  }

  return createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
