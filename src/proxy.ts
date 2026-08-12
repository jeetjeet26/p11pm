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

  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const claims = claimsData?.claims;

  if (claimsError || !claims?.sub) {
    return loginRedirect(request, response);
  }

  const upstreamHeaders = new Headers(request.headers);
  upstreamHeaders.set("x-p11-verified-user-id", claims.sub);
  const authenticatedResponse = NextResponse.next({
    request: { headers: upstreamHeaders },
  });
  response.cookies.getAll().forEach((cookie) => {
    authenticatedResponse.cookies.set(cookie);
  });
  return authenticatedResponse;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/inbox/:path*",
    "/projects/:path*",
    "/files/:path*",
    "/chat/:path*",
    "/roadmap/:path*",
    "/team/:path*",
    "/my-work/:path*",
    "/saved/:path*",
    "/capture/:path*",
    "/client/:path*",
    "/clients/:path*",
    "/retainers/:path*",
    "/time/:path*",
    "/billing/:path*",
    "/activity/:path*",
    "/reports/:path*",
    "/admin/:path*",
    "/archive/:path*",
  ],
};
