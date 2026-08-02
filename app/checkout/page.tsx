import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/site-header";
import { CheckoutClient } from "./checkout-client";
import { getCurrentUser } from "@/lib/auth/session";
import { getTiers, tierForPrice } from "@/lib/stripe/tiers";

export const metadata: Metadata = { title: "Checkout" };

/**
 * Server-side gate.
 *
 * Checked HERE, before a byte of the page is sent. A guard that runs in the browser is a
 * suggestion, not a guard.
 */
export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<{ price?: string }>;
}) {
  const { price } = await searchParams;
  const user = await getCurrentUser();

  if (!user) {
    // Through sign-in and back to this exact plan, so nobody loses the one they picked.
    const next = price ? `/checkout?price=${encodeURIComponent(price)}` : "/checkout";
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  // Already paying. Sending them through checkout again would create a SECOND subscription
  // and bill them twice, which is the exact failure this billing setup exists to prevent.
  if (user.isMember) redirect("/dashboard/billing");

  const tier = (await tierForPrice(price)) ?? (await getTiers())[1] ?? (await getTiers())[0];
  if (!tier) redirect("/");

  return (
    <>
      <SiteHeader
        user={{
          id: user.id,
          email: user.email,
          name: user.name,
          isAdmin: user.isAdmin,
          banned: user.banned,
          emailVerifiedAt: user.emailVerifiedAt,
        }}
      />
      <CheckoutClient tier={tier} />
    </>
  );
}
