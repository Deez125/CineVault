"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/**
 * "Forgot password?", carrying whatever they had already typed.
 *
 * Somebody who reaches for this link has usually just typed their address and failed on the
 * password. Making them type it a second time on the next screen is a small, avoidable
 * annoyance — and a chance to fat-finger a different address and then wonder why no email
 * arrives.
 *
 * The href stays a plain `/forgot`, so the link still works with no JS and when the field is
 * empty. The click handler only takes over when there is something worth carrying.
 */
export function ForgotPasswordLink() {
  const router = useRouter();

  return (
    <Link
      href="/forgot"
      className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
      onClick={(event) => {
        // Read the field rather than lifting it into state: the form is otherwise uncontrolled,
        // and making every keystroke re-render the page to serve one link is a poor trade.
        const field = event.currentTarget.closest("form")?.elements.namedItem("email");
        const email = field instanceof HTMLInputElement ? field.value.trim() : "";

        // 320 is the longest an address is allowed to be. Anything past that is not one, and
        // there is no reason to put it in a URL.
        if (!email || email.length > 320) return;

        event.preventDefault();
        router.push(`/forgot?email=${encodeURIComponent(email)}`);
      }}
    >
      Forgot password?
    </Link>
  );
}
