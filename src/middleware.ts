import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { hasSessionCookie, signInRedirectUrl } from "@/lib/app-gate";

/**
 * Soft gate for /app/*: redirect to sign-in when no better-auth session cookie
 * is present. Pages still call requireUser() for a hard session check.
 */
export function middleware(request: NextRequest) {
  if (!hasSessionCookie((name) => request.cookies.get(name))) {
    return NextResponse.redirect(
      signInRedirectUrl(request.url, request.nextUrl.pathname),
    );
  }

  return NextResponse.next();
}

/* c8 ignore start — config object is read by Next; brace/as-const maps oddly under tsx */
export const config = {
  matcher: ["/app", "/app/:path*"],
};
/* c8 ignore stop */
