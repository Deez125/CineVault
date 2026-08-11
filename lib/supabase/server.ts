import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { env } from "@/lib/env";

/**
 * The Supabase client for server-side code — route handlers, server actions, server
 * components. It reads and writes the Supabase auth cookies through Next's cookie store, so
 * signing in from a form action lands the session on the response and the very next request
 * sees it.
 *
 * Server components CANNOT write cookies (Next disallows it). The setAll below silently
 * swallows the resulting error precisely so a getUser() call from a page's render is safe;
 * the actual refresh happens in the root middleware, where cookies CAN be written.
 *
 * A NEW client per request. Do not hoist it to a module constant: the cookie store is bound
 * to the current request, and reusing a client across requests would leak sessions.
 */
export async function getSupabaseServer() {
  const cookieStore = await cookies();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component. Next.js forbids cookie writes there. That is fine
          // — the middleware refreshes the session on the same request and its response
          // carries the updated cookies. Swallowing lets getUser() work inside pages.
        }
      },
    },
  });
}
