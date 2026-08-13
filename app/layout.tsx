import type { Metadata } from "next";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "@/components/theme-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "CineVault",
    template: "%s · CineVault",
  },
  description:
    "A private Discord for serious movie and TV lovers. Discuss classics, uncover hidden gems, share recommendations, and enjoy curated libraries together in a tight-knit group.",
  icons: { icon: "/favicon.png" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    // suppressHydrationWarning is required by next-themes: it sets the theme class on <html>
    // before React hydrates, so the server and client markup legitimately differ by one
    // attribute and React would otherwise warn on every page.
    <html
      lang="en"
      suppressHydrationWarning
      style={{ ["--font-sans" as string]: "ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" }}
    >
      {/* suppressHydrationWarning on <body> too — some browser extensions (ColorZilla,
          ad blockers, translation tools) inject attributes on body before React hydrates,
          which triggers a legitimate but noisy console warning on every render. Not our
          bug, not fixable in our code; suppressing it here is the standard escape. */}
      <body className="min-h-dvh font-sans antialiased" suppressHydrationWarning>
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          {children}
          <Toaster />
        </ThemeProvider>
      </body>
    </html>
  );
}
