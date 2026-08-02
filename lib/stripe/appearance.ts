import type { Appearance } from "@stripe/stripe-js";

/**
 * Stripe Elements theming.
 *
 * This is the whole reason checkout uses the **Payment Element** rather than Embedded
 * Checkout. Embedded Checkout renders inside a Stripe-owned cross-origin iframe that our CSS
 * cannot reach and that does not accept these options, so it cannot be themed to match the
 * site. Payment Element can.
 *
 * The values are read from the colour index at runtime rather than duplicated here, so the
 * card form follows the site instead of drifting away from it the first time a colour
 * changes. That does mean this must be called in the BROWSER, after styles have loaded.
 */
export function stripeAppearance(): Appearance {
  const css = getComputedStyle(document.documentElement);
  const token = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;

  const isDark = document.documentElement.classList.contains("dark");

  const background = token("--card", isDark ? "#161920" : "#ffffff");
  const foreground = token("--foreground", isDark ? "#e9ecf3" : "#111318");
  const muted = token("--muted-foreground", isDark ? "#8b93a7" : "#646c7e");
  const primary = token("--primary", "#3b82f6");
  const border = token("--border", isDark ? "#242833" : "#e4e7ec");
  const danger = token("--destructive", "#ef4444");
  const surface = token("--background", isDark ? "#0f1115" : "#ffffff");

  return {
    theme: isDark ? "night" : "stripe",
    variables: {
      colorPrimary: primary,
      colorBackground: background,
      colorText: foreground,
      colorTextSecondary: muted,
      colorTextPlaceholder: muted,
      colorDanger: danger,
      colorIcon: muted,

      // Tab icons are painted from these, NOT from a .TabIcon rule. Without
      // colorIconTabSelected the chosen tab's icon renders near-black on a dark surface,
      // so the one icon you cannot see is the one you just picked.
      colorIconTab: muted,
      colorIconTabHover: foreground,
      colorIconTabSelected: primary,
      colorIconTabMore: muted,
      colorIconTabMoreHover: foreground,

      fontFamily: 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
      fontSizeBase: "15px",
      borderRadius: "10px",
      spacingUnit: "4px",
    },
    rules: {
      ".Input": { backgroundColor: surface, border: `1px solid ${border}`, boxShadow: "none" },
      ".Input:focus": {
        border: `1px solid ${primary}`,
        boxShadow: `0 0 0 3px color-mix(in oklch, ${primary} 30%, transparent)`,
      },
      ".Input--invalid": { border: `1px solid ${danger}`, boxShadow: "none" },

      ".Tab": {
        backgroundColor: surface,
        border: `1px solid ${border}`,
        boxShadow: "none",
        color: muted,
      },
      ".Tab:hover": { color: foreground },
      ".Tab--selected": {
        backgroundColor: surface,
        border: `1px solid ${primary}`,
        boxShadow: "none",
        color: foreground,
      },
      ".TabLabel": { color: muted },
      ".TabLabel--selected": { color: foreground },

      ".Label": { color: muted, fontWeight: "500" },
      ".Block": { backgroundColor: surface, border: `1px solid ${border}` },
    },
  };
}
