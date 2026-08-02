"use client";

import { useTheme } from "next-themes";
import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Light/dark switch.
 *
 * Both icons are rendered and CSS decides which is visible, rather than a `mounted` flag
 * gating the render. The server cannot know which theme the browser will resolve to, so a
 * flag-based version has to render nothing on the first pass and swap in the real icon after
 * hydration — which is both a visible flicker and a synchronous setState inside an effect.
 * Letting the `dark:` variant do it means the correct icon is right from the first paint.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <Button
      variant="ghost"
      size="icon"
      className={className}
      aria-label="Toggle light and dark mode"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
    >
      <Sun className="hidden size-4 dark:block" />
      <Moon className="size-4 dark:hidden" />
    </Button>
  );
}
