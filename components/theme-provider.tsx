"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";
import type { ComponentProps } from "react";

/**
 * Light and dark.
 *
 * `next-themes` writes a `.dark` class onto <html> before first paint, which is what the
 * colour index in globals.css keys off. Doing it before paint is the whole trick: set the
 * class in React and every dark-mode user gets a white flash on every page load.
 */
export function ThemeProvider({ children, ...props }: ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
