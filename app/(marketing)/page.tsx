import { getSessionUser } from "@/lib/auth/session";
import { LandingClient } from "./landing-client";

/**
 * The landing page.
 *
 * Server wrapper around the (heavy, client-only) landing implementation. Only reason this
 * layer exists is to read the current session server-side, so the header can render either
 * the signed-out CTAs (Sign in / Get started) or a signed-in chip immediately — no flash of
 * the wrong state and no client round-trip to Supabase.
 */
export default async function LandingPage() {
  const user = await getSessionUser();

  return (
    <LandingClient
      user={
        user
          ? {
              email: user.email,
              firstName: user.firstName,
              lastName: user.lastName,
              username: user.username,
              avatarUrl: user.avatarUrl,
            }
          : null
      }
    />
  );
}
