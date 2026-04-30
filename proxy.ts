// proxy.ts — Edge proxy: gates auth API routes by the provider registry.
//
// Any request to /api/auth/<provider>/... returns 404 if that provider is not
// in ENABLED_PROVIDERS. This is the single enforcement point — individual route
// handlers do not need their own isProviderEnabled() checks.
//
// "session" and "logout" are infrastructure routes, not provider ids — excluded.

import { NextRequest, NextResponse } from "next/server";
import { isProviderEnabled } from "@/lib/auth-providers/registry";

const INFRASTRUCTURE_ROUTES = new Set(["session", "logout"]);

export function proxy(req: NextRequest) {
  const match = req.nextUrl.pathname.match(
    /^(?:\/[^/]+)?\/api\/auth\/([^/]+)/
  );
  if (match) {
    const provider = match[1];
    if (!INFRASTRUCTURE_ROUTES.has(provider) && !isProviderEnabled(provider)) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/api/auth/:path*"],
};
