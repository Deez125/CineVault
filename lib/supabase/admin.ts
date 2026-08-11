import "server-only";

import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

/**
 * The Supabase admin client — service-role key, no session, no cookies.
 *
 * Used ONLY for operations that need to act on behalf of the platform: banning a user,
 * updating email in the auth table without a login, creating users from admin scripts. The
 * service-role key can read every user and impersonate anyone; nothing that could reach the
 * browser may import this module.
 *
 * `autoRefreshToken` and `persistSession` are OFF because the service role does not have a
 * session in the same sense — it is authenticated by the header on every call, and turning
 * these on would have the SDK try to write cookies from a Node runtime that has none.
 */
export const supabaseAdmin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});
