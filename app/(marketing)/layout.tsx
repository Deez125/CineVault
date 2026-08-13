/**
 * Shell for the public-facing pages. Deliberately does nothing beyond passing children
 * through — every page under (marketing) renders its own header and footer.
 *
 * The landing page has a full custom shell it needs to own end-to-end (dark theme,
 * animated nav, sticky brand). The help/terms/privacy pages use SiteHeader + a plain
 * shared footer. Putting a layout-level header or footer here would stack under one and
 * fight the other.
 */
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
