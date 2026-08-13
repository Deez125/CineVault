import Image from "next/image";
import Link from "next/link";

/**
 * The shell for sign in, sign up, password reset, check-email, and every other page a
 * signed-out visitor lands on. Deliberately dark and quiet, matching the landing so the
 * auth flow feels like part of the same site rather than a Vercel default.
 *
 * The theme toggle that used to live in the corner is gone: this screen is always dark,
 * regardless of what the visitor's system or app theme is set to. Nothing on this page
 * benefits from a light variant, and choosing between them is one more thing to ignore
 * during a sign-in.
 *
 * The `dark` class on the wrapper forces shadcn form controls (Input, Label, Button) into
 * their dark variants without touching the app-wide theme. The hard-coded ink/paper values
 * match the landing so a nav from "/" to "/login" is a scene change, not a repaint.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="dark relative flex min-h-dvh flex-col items-center justify-center px-4 py-10 text-[#ECF0F8] sm:px-6 sm:py-12"
      style={{ background: "#06070B" }}
    >
      {/* Same font imports as the landing — Anton for display, IBM Plex Mono for eyebrow
          labels. Loaded at request time from Google Fonts; the browser caches them across
          the landing / auth / marketing routes. */}
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Anton&family=IBM+Plex+Mono:wght@400;500&display=swap');
        .auth-display { font-family: 'Anton', 'Arial Narrow', Impact, sans-serif; letter-spacing: .01em; text-transform: uppercase; }
        .auth-mono { font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace; letter-spacing: .18em; text-transform: uppercase; font-size: 11px; }
        .auth-eyebrow { color: #4D7CFE; display: inline-flex; align-items: center; gap: 12px; }
        .auth-eyebrow::before { content: ""; width: 22px; height: 1px; background: #4D7CFE; opacity: .7; display: inline-block; }
      `}</style>

      <Link href="/" className="mb-10 flex items-center" aria-label="CineVault">
        <Image
          src="/logo.svg"
          alt="CineVault"
          width={140}
          height={32}
          priority
          className="h-8 w-auto"
        />
      </Link>

      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}
