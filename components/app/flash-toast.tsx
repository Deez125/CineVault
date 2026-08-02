"use client";

import { useEffect, useRef } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";

/**
 * Turn a one-off result carried in the URL into a toast, then clean the URL.
 *
 * A banner for something that already happened stays on the page forever, gets in the way of
 * the thing it is reporting on, and comes back every time somebody reloads or shares the
 * link. A toast says it once and leaves.
 *
 * Cleaning the query string afterwards is the other half: without it, a refresh re-announces
 * a link that happened ten minutes ago.
 */
export function FlashToast({
  message,
  variant = "success",
}: {
  message: string | null;
  variant?: "success" | "error";
}) {
  const router = useRouter();
  const pathname = usePathname();

  // React runs effects twice in development. Without this guard every result is announced
  // twice, which looks like a bug in whatever produced it.
  const fired = useRef(false);

  useEffect(() => {
    if (!message || fired.current) return;
    fired.current = true;

    if (variant === "error") toast.error(message);
    else toast.success(message);

    // replace, not push: the result is spent, and it should not be somewhere the back button
    // can return to.
    router.replace(pathname, { scroll: false });
  }, [message, variant, router, pathname]);

  return null;
}
