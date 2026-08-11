import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { env } from "@/lib/env";

/**
 * Refresh the Supabase session on every request and put the fresh cookies on the response.
 *
 * WHY THIS EXISTS: server components cannot write cookies, so a token that expires between
 * requests would sign the user out mid-navigation. The root middleware runs on every request,
 * calls getUser() which triggers a refresh if the access token is close to expiring, and puts
 * the new tokens on the outgoing response. The next request comes in with a fresh session.
 *
 * The two-pass NextResponse.next({ request }) is not a mistake — the first is a placeholder,
 * and setAll rebuilds it with the mutated cookies. Without it, only the incoming request has
 * the new cookies and the browser is never told.
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
  await supabase.auth.getUser();

  return response;
}
