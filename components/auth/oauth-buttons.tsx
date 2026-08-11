"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { getSupabaseBrowser } from "@/lib/supabase/client";

/**
 * "Continue with Google" (and any other providers we enable later).
 *
 * Client component so it can call the browser Supabase client, which handles the OAuth
 * handshake — it opens the provider's consent screen and, on approval, returns to
 * `/auth/callback` with a code that the server-side handler exchanges for a session.
 *
 * The provider button is deliberately its own component rather than a link: `signInWithOAuth`
 * needs the browser client with its cookie/localStorage state, and rendering the redirect on
 * the server would miss the point.
 */
export function OAuthButtons({ next }: { next?: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function signInWith(provider: "google") {
    setError(null);
    startTransition(async () => {
      const supabase = getSupabaseBrowser();

      // `redirectTo` gets appended to the OAuth consent URL as `redirect_to`. Supabase then
      // includes it in its own callback so the visitor lands at OUR /auth/callback with the
      // code — same handler as the email-confirm flow.
      const callback = new URL("/auth/callback", window.location.origin);
      if (next) callback.searchParams.set("next", next);

      const { error: err } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: callback.toString() },
      });

      // `signInWithOAuth` normally redirects the whole page, so we only reach here on error.
      if (err) setError(err.message);
    });
  }

  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={() => signInWith("google")}
        disabled={pending}
      >
        <GoogleGlyph className="mr-2 size-4" />
        {pending ? "Redirecting…" : "Continue with Google"}
      </Button>

      {error && <p className="text-center text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Google's four-colour "G" glyph, inline so we don't hit an external asset. */
function GoogleGlyph({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden className={className}>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.75h3.57c2.08-1.92 3.28-4.74 3.28-8.07z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.75c-.99.66-2.25 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.12c-.22-.66-.35-1.36-.35-2.12s.13-1.46.35-2.12V7.04H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.96l3.66-2.84z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.04l3.66 2.84c.87-2.6 3.3-4.5 6.16-4.5z"
      />
    </svg>
  );
}
