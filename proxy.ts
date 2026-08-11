import type { NextRequest } from "next/server";
import { refreshSupabaseSession } from "@/lib/supabase/middleware";

/**
 * Runs on every request, refreshes the Supabase session cookie if it's near expiry.
 *
 * Server components CANNOT write cookies, so a token that expires between requests would
 * silently sign the user out mid-navigation. This middleware calls getUser() (which triggers
 * a refresh) and puts the new tokens on the outgoing response — the next request starts
 * fresh. Nothing else the app does needs to think about token lifetime after this.
 *
 * The matcher excludes anything that has no need for auth state: static assets, Next's own
 * chunks, images. This runs a LOT — being surgical about what it applies to keeps the
 * request-per-second budget sane.
 */
export async function proxy(request: NextRequest) {
  return refreshSupabaseSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything EXCEPT:
     *   - _next/static  (built assets — no cookies, no auth)
     *   - _next/image   (image optimiser output)
     *   - favicon.ico, logo.png (root-level static files)
     *   - api/webhooks/* (Stripe/Plex webhooks — they verify signatures, not sessions)
     *   - anything with a file extension (svg, png, css, js, ...) that Next serves directly
     */
    "/((?!_next/static|_next/image|favicon.ico|logo\\.png|api/webhooks|.*\\..*).*)",
  ],
};
