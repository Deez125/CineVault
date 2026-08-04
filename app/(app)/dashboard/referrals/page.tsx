import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { InviteList } from "@/components/app/invite-list";
import { StatCard } from "@/components/app/stat-card";
import { requireMember } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/money";
import { markNavSeen } from "@/lib/nav-seen";
import {
  LINK_LIFETIME_DAYS,
  MONTHLY_LINK_CAP,
  REFEREE_PERCENT_OFF,
  REFERRAL_REWARD,
  getSummary,
} from "@/lib/referrals";

export const metadata: Metadata = { title: "Referrals" };

export default async function ReferralsPage() {
  const user = await requireMember();

  // Opening the section clears its dot. Done on the SERVER so it sticks without
  // JavaScript and however they arrived — a bookmark, browser back, a link elsewhere.
  await markNavSeen("/dashboard/referrals");
  const summary = await getSummary(user);

  return (
    <>
      <PageHeader
        title="Referrals"
        subtitle={`${formatMoney(REFERRAL_REWARD)} off your bill for everyone who joins`}
      />

      <div className="space-y-6">
        <InviteList
          invites={summary.invites}
          slotsLeft={summary.slotsLeft}
          cap={summary.cap}
          origin={env.APP_URL}
        />

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Credit earned"
            value={formatMoney(summary.earned, summary.currency)}
            hint={summary.earned > 0 ? "Comes off your next invoice" : "Nothing yet"}
            tone={summary.earned > 0 ? "success" : "default"}
          />
          <StatCard
            label="Joined"
            value={summary.rewarded + summary.pending}
            hint={
              summary.pending > 0
                ? `${summary.pending} haven't paid yet`
                : summary.rewarded > 0
                  ? "All paid up"
                  : undefined
            }
          />
          <StatCard
            label="Invites left"
            value={summary.slotsLeft}
            hint={`${MONTHLY_LINK_CAP} a month`}
            tone={summary.slotsLeft === 0 ? "warning" : "default"}
          />
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="text-sm font-medium">How it works</div>
          <ol className="mt-3 space-y-2.5 text-sm text-muted-foreground">
            <li className="flex gap-3">
              <Step n={1} />
              <span>
                Generate an invite link and send it to somebody. You get {MONTHLY_LINK_CAP} a
                month, and each one works for one person.
              </span>
            </li>
            <li className="flex gap-3">
              <Step n={2} />
              <span>
                They sign up through it and pick a plan — any plan — at {REFEREE_PERCENT_OFF}% off
                their first month.
              </span>
            </li>
            <li className="flex gap-3">
              <Step n={3} />
              <span>
                Once their first payment goes through, {formatMoney(REFERRAL_REWARD)} comes off
                your next bill.
              </span>
            </li>
          </ol>

          <p className="mt-4 border-t pt-4 text-xs text-muted-foreground">
            Invites last {LINK_LIFETIME_DAYS} days. If one expires, or you revoke it before
            anybody uses it, you get that slot back straight away.
          </p>
        </div>
      </div>
    </>
  );
}

function Step({ n }: { n: number }) {
  return (
    <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-foreground">
      {n}
    </span>
  );
}
