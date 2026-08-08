import { NextResponse } from "next/server";

import { safeNextPath } from "@/lib/auth/redirect";
import { isDemoModeAllowed } from "@/lib/demo-mode";

export async function POST(request: Request) {
  if (!isDemoModeAllowed()) {
    return Response.json(
      { error: "Demo mode is disabled in production." },
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get("next"));
  const response = NextResponse.json({ next });
  response.cookies.set("p11-demo", "true", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 8,
    path: "/",
  });

  return response;
}
