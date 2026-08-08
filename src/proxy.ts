import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import {
  isSupabaseConfigured,
  supabasePublishableKey,
  supabaseUrl,
} from "@/lib/supabase/config";
import { isDemoModeAllowed } from "@/lib/demo-mode";

function loginRedirect(request: NextRequest, refreshedResponse?: NextResponse) {
  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set(
    "next",
    `${request.nextUrl.pathname}${request.nextUrl.search}`,
  );
  const redirectResponse = NextResponse.redirect(loginUrl);
  refreshedResponse?.cookies.getAll().forEach((cookie) => {
    redirectResponse.cookies.set(cookie);
  });
  return redirectResponse;
}

export async function proxy(request: NextRequest) {
  if (
    isDemoModeAllowed() &&
    request.cookies.get("p11-demo")?.value === "true"
  ) {
    return NextResponse.next();
  }

  if (!isSupabaseConfigured || !supabaseUrl || !supabasePublishableKey) {
    return loginRedirect(request);
  }

  let response = NextResponse.next({ request });
  const supabase = createServerClient(supabaseUrl, supabasePublishableKey, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return loginRedirect(request, response);
  }

  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/projects/:path*",
    "/chat/:path*",
    "/team/:path*",
    "/my-work/:path*",
    "/activity/:path*",
    "/admin/:path*",
  ],
};
