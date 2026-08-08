import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  const supabase = await createClient();
  if (supabase) {
    const { error } = await supabase.auth.signOut();
    if (error) console.error("Supabase sign-out failed:", error);
  }

  const response = NextResponse.redirect(new URL("/login", request.url), 303);
  response.cookies.delete("p11-demo");
  return response;
}
