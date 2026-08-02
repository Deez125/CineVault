import type { Metadata } from "next";
import { SiteHeader } from "@/components/site/site-header";
import { DoneClient } from "./done-client";
import { getCurrentUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Payment" };

export default async function CheckoutDonePage({
  searchParams,
}: {
  searchParams: Promise<{ subscription_id?: string }>;
}) {
  const { subscription_id } = await searchParams;
  const user = await getCurrentUser();

  return (
    <>
      <SiteHeader
        user={
          user
            ? {
                id: user.id,
                email: user.email,
                name: user.name,
                isAdmin: user.isAdmin,
                banned: user.banned,
                emailVerifiedAt: user.emailVerifiedAt,
              }
            : null
        }
      />
      <DoneClient subscriptionId={subscription_id ?? null} />
    </>
  );
}
