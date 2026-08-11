import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * Runs on every request. Two jobs:
 *
 *   1. Refresh the Supabase session cookie if the access token is near expiry. Server
 *      components cannot write cookies, so a token that expires mid-navigation would
 *      silently sign the user out — the proxy is the only place with a Response object to
 *      hand the browser fresh tokens on.
 *
 *   2. Gate the app behind the /setup screen. Any signed-in visitor whose auth-user
 *      metadata does not carry `setup_complete: true` is bounced to /setup, whatever page
 *      they were trying to reach. Exempt paths cover the flows that need to run BEFORE
 *      setup exists (auth callbacks, the marketing homepage, /setup itself, password reset
 *      links) so the gate cannot lock somebody out of the very flow that would let them
 *      complete it.
 *
 * The two-pass NextResponse.next({ request }) is not a mistake — the first is a placeholder,
 * and setAll rebuilds it with the mutated cookies. Without it, only the incoming request
 * has the new cookies and the browser is never told.
 */
export async function refreshSupabaseSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet) => {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // getUser() is the required call. getSession() alone reads the cookie but does not verify
  // the JWT with the Supabase server, so a tampered cookie would sail through. getUser()
  // forces the verification and also triggers a refresh if needed.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (user && shouldGateForSetup(request, user.user_metadata ?? {})) {
    return NextResponse.redirect(new URL("/setup", env.APP_URL));
  }

  return response;
}

/**
 * The `setup_complete` marker lives on the auth user's metadata so the proxy can read it
 * from the JWT the middleware already validated, with no extra DB roundtrip per request.
 * The /setup action writes it there and to `public.users.setup_complete` in the same
 * transaction; whichever the source, the truth is the same.
 *
 * Anonymous visitors never hit the gate — the setup page exists to configure a user, and
 * there is no user to configure.
 */
function shouldGateForSetup(
  request: NextRequest,
  metadata: Record<string, unknown>
): boolean {
  if (metadata.setup_complete === true) return false;

  const path = request.nextUrl.pathname;

  // Paths that must work BEFORE setup exists:
  //   - /setup itself (or the redirect loop is infinite)
  //   - /  is the marketing homepage — the one place a signed-in visitor is allowed to see
  //     unrelated to their account
  //   - /auth/*  the callback and confirm handlers, which run the flow that JUST signed
  //     them in and can't be interrupted
  //   - /verify  legacy redirect target from old email links
  //   - /reset  password reset, which the visitor may have started before setup finished
  //   - /api/*  route handlers with their own auth
  //   - /logout, /signout  never redirect a sign-out; that would trap them signed in
  //   - static files (already excluded by the proxy matcher, listed for completeness)
  if (
    path === "/setup" ||
    path === "/" ||
    path.startsWith("/auth/") ||
    path === "/verify" ||
    path === "/reset" ||
    path === "/forgot" ||
    path.startsWith("/api/") ||
    path === "/logout" ||
    path === "/signout"
  ) {
    return false;
  }

  return true;
}
