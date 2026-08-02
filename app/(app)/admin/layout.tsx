import { requireAdmin } from "@/lib/auth";

/**
 * The admin gate.
 *
 * `requireAdmin()` answers 404, not a redirect: somebody who is not an admin should not learn
 * that an admin panel exists at this URL. It runs here so every page beneath is gated by
 * construction, and every admin API route checks for itself as well — gating pages alone
 * would leave the data routes answering to anyone.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdmin();
  return <>{children}</>;
}
