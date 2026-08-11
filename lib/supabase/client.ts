"use client";

import { createBrowserClient } from "@supabase/ssr";

/**
 * The Supabase client for browser code — used from client components that need to sign in
 * with an OAuth provider, watch auth state, or read the session on the client.
 *
 * `process.env.NEXT_PUBLIC_*` is inlined at build time by Next, so it works in the browser
 * without any server round-trip. This module DELIBERATELY does not import `lib/env`, which
 * validates server-only secrets and would fail to load client-side.
 *
 * One client per browser tab. The SDK keeps its own reference to the session in
 * cookies + localStorage; instantiating a second one is harmless but adds no benefit.
 */
let cached: ReturnType<typeof createBrowserClient> | null = null;

export function getSupabaseBrowser() {
  if (cached) return cached;
  cached = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
  return cached;
}
