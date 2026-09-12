import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME, verifySession } from "@/lib/passcode";

/**
 * Shared-passcode gate (PLAN.md §2 "Access").
 *
 * Next.js 16 renamed the `middleware` file convention to `proxy`, so the gate
 * lives in `src/proxy.ts` and exports `proxy` rather than `middleware`.
 *
 * Everything except the entry screen and its route handler requires a valid
 * signed cookie. `/api/*` is gated too: those are stateless LLM calls the
 * pilot pays for.
 */
const PUBLIC_PATHS = new Set(["/enter", "/api/enter"]);

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (PUBLIC_PATHS.has(pathname)) return NextResponse.next();

  const token = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (await verifySession(token, process.env.PASSCODE_COOKIE_SECRET)) {
    return NextResponse.next();
  }

  // API callers get a status they can act on; a redirect to an HTML page would
  // be re-POSTed to /enter and silently swallowed by fetch().
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Passcode required." }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/enter";
  url.search = "";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Everything except Next's own static output, the favicon, and files in
    // public/. Without this the gate would also block CSS and images.
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
