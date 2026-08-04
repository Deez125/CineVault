import Link from "next/link";
import { Check, Hash, History, Popcorn, Sparkles, Star, Vote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { SiteHeader } from "@/components/site/site-header";
import { getCurrentUser } from "@/lib/auth/session";
import { getTiers } from "@/lib/stripe/tiers";
import { formatMoney } from "@/lib/stripe/client";
import { cn } from "@/lib/utils";

/**
 * The landing page.
 *
 * Copy is carried over from the previous site word for word, deliberately. Only the palette
 * and the components underneath it have changed.
 *
 * Rendered on the server: the plans come from Stripe and the "your plan" marker comes from
 * the session, so both are correct in the first byte rather than appearing a moment later.
 */

const FEATURES = [
  { icon: Vote, label: "Weekly movie polls & discussions" },
  { icon: Sparkles, label: "Curated recommendation lists" },
  { icon: Popcorn, label: "Live watch parties" },
  { icon: Star, label: "Member reviews & ratings" },
  { icon: History, label: "Watch history sync (via Plex)" },
  { icon: Hash, label: "Exclusive channels for different genres" },
];

export default async function HomePage() {
  const user = await getCurrentUser();

  // A Stripe outage should not take the whole page down. The plans disappear and everything
  // else still renders, which at least tells a visitor the site exists.
  const tiers = await getTiers().catch(() => []);

  const current = user?.isMember ? user.streamLimit : 0;

  // Admins are members with no tier, so `current` matches nothing and every card would
  // otherwise invite them to buy something the checkout will refuse them.
  const isAdmin = Boolean(user?.isAdmin);

  return (
    <>
      <SiteHeader
        user={
          user
            ? {
                id: user.id,
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                username: user.username,
                isAdmin: user.isAdmin,
                banned: user.banned,
                emailVerifiedAt: user.emailVerifiedAt,
                isMember: user.isMember,
                streamLimit: user.streamLimit,
                plexUserId: user.plexUserId,
                navSeen: user.navSeen,
              }
            : null
        }
      />

      <main className="relative overflow-hidden">
        {/* A slow bloom behind the hero. Enough to feel alive, not enough to notice. */}
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/2 size-[36rem] -translate-x-1/2 rounded-full opacity-[0.10] blur-3xl"
          style={{
            background: "radial-gradient(circle, var(--primary) 0%, transparent 70%)",
          }}
        />

        <div className="relative mx-auto max-w-6xl px-6 pb-24 pt-20">
          <div className="mx-auto max-w-2xl text-center">
            <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
              Lights, Camera, <span className="text-primary">Community.</span>
            </h1>
            <p className="mx-auto mt-5 max-w-xl text-muted-foreground">
              A private Discord for serious movie and TV lovers. Discuss classics, uncover
              hidden gems, share recommendations, and enjoy curated libraries together in a
              tight-knit group.
            </p>
          </div>

          {tiers.length === 0 && (
            <Alert variant="destructive" className="mx-auto mt-8 max-w-lg">
              <AlertDescription>
                Plans are unavailable right now. Please try again in a moment.
              </AlertDescription>
            </Alert>
          )}

          <div className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {tiers.map((tier) => {
              const isCurrent = current === tier.streams;
              const featured = tier.streams === 2; // the one most people actually want

              return (
                <div
                  key={tier.priceId}
                  className={cn(
                    "relative flex flex-col rounded-xl border bg-card p-6 transition-colors",
                    featured ? "border-primary/40" : "hover:border-foreground/20"
                  )}
                >
                  {featured && !isCurrent && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-primary px-2.5 py-0.5 text-[11px] font-semibold text-primary-foreground">
                      Most popular
                    </span>
                  )}
                  {isCurrent && (
                    <span className="absolute -top-2.5 left-1/2 -translate-x-1/2 rounded-full bg-success px-2.5 py-0.5 text-[11px] font-semibold text-success-foreground">
                      Your plan
                    </span>
                  )}

                  <div className="text-sm font-medium text-muted-foreground">{tier.label}</div>

                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-3xl font-semibold tabular-nums">
                      {formatMoney(tier.amount, tier.currency)}
                    </span>
                    <span className="text-sm text-muted-foreground">/{tier.interval}</span>
                  </div>

                  <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                    {tier.blurb}
                  </p>

                  <ul className="mt-5 space-y-2 text-sm">
                    {[
                      `${tier.streams} concurrent stream${tier.streams === 1 ? "" : "s"}`,
                      "The full library",
                      "Cancel any time",
                    ].map((feature) => (
                      <li key={feature} className="flex items-center gap-2">
                        <Check className="size-4 shrink-0 text-success" />
                        {feature}
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <Button disabled variant="secondary" size="lg" className="mt-6">
                      Current plan
                    </Button>
                  ) : (
                    // Signed out, this lands on checkout, which bounces through sign-in and
                    // returns here, so nobody loses the plan they picked. Already subscribed,
                    // changing tier is a swap on the EXISTING subscription from the billing
                    // page, never a second checkout: paying twice for one membership is the
                    // exact failure the previous billing setup was built to escape.
                    <Button
                      variant={featured ? "default" : "secondary"}
                      size="lg"
                      className="mt-6"
                      render={
                        <Link
                          href={
                            isAdmin || current > 0
                              ? "/dashboard/billing"
                              : `/dashboard/billing?price=${encodeURIComponent(tier.priceId)}`
                          }
                        />
                      }
                    >
                      {isAdmin ? "Your plan is Admin" : current > 0 ? "Switch to this" : "Choose"}
                    </Button>
                  )}
                </div>
              );
            })}
          </div>

          {/* What the membership actually IS. The tiers above sell a number; this sells the
              reason anyone would want one. */}
          <div className="mt-16 rounded-xl border bg-card p-8">
            <h2 className="text-center text-lg font-semibold">What&apos;s inside</h2>

            <div className="mx-auto mt-7 grid max-w-3xl gap-x-10 gap-y-5 sm:grid-cols-2">
              {FEATURES.map(({ icon: Icon, label }) => (
                <div key={label} className="flex items-center gap-3">
                  <Icon className="size-[18px] shrink-0 text-primary" />
                  <span className="text-sm text-muted-foreground">{label}</span>
                </div>
              ))}
            </div>
          </div>

          <p className="mt-10 text-center text-sm text-muted-foreground">
            After subscribing, link your Plex account in{" "}
            <Link
              href="/dashboard/plex"
              className="underline underline-offset-2 transition-colors hover:text-primary"
            >
              Account Settings
            </Link>{" "}
            to sync watch activity with the community.
          </p>
        </div>
      </main>
    </>
  );
}
