"use client";

import { Button } from "@/components/ui/button";

/**
 * "Continue with Google" (and any other providers we enable later).
 *
 * Rendered disabled at the moment — the Google OAuth client is not configured in the
 * Supabase dashboard yet, so clicking the button would bounce to a Supabase error page
 * that reads worse than a plainly-labelled "Soon". The full click handler and the
 * signInWithOAuth call are ready to go the day the provider is enabled; see
 * TODO.md → Auth → "Wire up Google OAuth". Delete this file's `disabled` and the "Soon"
 * pill, restore the client hook logic (git blame shows the version to bring back), and it
 * works end-to-end because /auth/callback already handles the OAuth code exchange.
 *
 * The `next` prop is accepted but ignored right now so callers do not have to touch every
 * page the day we do turn it on.
 */
export function OAuthButtons({ next: _next }: { next?: string }) {
  return (
    <div className="space-y-3">
      <Button
        type="button"
        variant="outline"
        className="relative w-full opacity-60"
        disabled
        aria-disabled
      >
        <GoogleGlyph className="mr-2 size-4" />
        Continue with Google
        <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
          Soon
        </span>
      </Button>
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
