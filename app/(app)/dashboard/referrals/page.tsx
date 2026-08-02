import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { ReferralLink } from "@/components/app/referral-link";
import { StatCard } from "@/components/app/stat-card";
import { requireUser } from "@/lib/auth";
import { env } from "@/lib/env";
import { formatMoney } from "@/lib/stripe/client";
import {
  MONTHLY_REWARD_CAP,
  REFEREE_PERCENT_OFF,
  REFERRAL_REWARD,
  getSummary,
} from "@/lib/referrals";

export const metadata: Metadata = { title: "Referrals" };

const STATUS: Record<string, { label: string; className: string }> = {
  pending: { label: "Signed up", className: "text-muted-foreground" },
  rewarded: { label: "Credited", className: "text-success" },
  capped: { label: "Over the monthly cap", className: "text-warning" },
};

export default async function ReferralsPage() {
  const user = await requireUser("/dashboard/referrals");
  const summary = await getSummary(user);

  const url = `${env.APP_URL}/signup?ref=${summary.code}`;

  return (
    <>
      <PageHeader
        title="Referrals"
        subtitle={`${formatMoney(REFERRAL_REWARD)} off your bill for everyone who joins`}
      />

      <div className="space-y-6">
        <ReferralLink code={summary.code} url={url} />

        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard
            label="Credit earned"
            value={formatMoney(summary.earned, summary.currency)}
            hint={summary.earned > 0 ? "Comes off your next invoice" : "Nothing yet"}
            tone={summary.earned > 0 ? "success" : "default"}
          />
          <StatCard
            label="Joined"
            value={summary.rewarded + summary.capped}
            hint={summary.pending > 0 ? `${summary.pending} signed up, not paid yet` : undefined}
          />
          <StatCard
            label="Left this month"
            value={summary.remainingThisMonth}
            hint={`${MONTHLY_REWARD_CAP} paid referrals a month`}
            tone={summary.remainingThisMonth === 0 ? "warning" : "default"}
          />
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="text-sm font-medium">How it works</div>
          <ol className="mt-3 space-y-2.5 text-sm text-muted-foreground">
            <li className="flex gap-3">
              <Step n={1} />
              <span>Send someone your link.</span>
            </li>
            <li className="flex gap-3">
              <Step n={2} />
              <span>
                They sign up and pick a plan — any plan — at {REFEREE_PERCENT_OFF}% off their first
                month.
              </span>
            </li>
            <li className="flex gap-3">
              <Step n={3} />
              <span>
                Once their first payment goes through, {formatMoney(REFERRAL_REWARD)} comes off your
                next bill. Not a one-off: every person you bring counts, up to{" "}
                {MONTHLY_REWARD_CAP} a month.
              </span>
            </li>
          </ol>
        </div>

        {summary.recent.length > 0 && (
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="border-b px-5 py-3.5 text-sm font-medium">Your referrals</div>
            <ul className="divide-y">
              {summary.recent.map((referral) => {
                const status = STATUS[referral.status] ?? STATUS.pending;

                return (
                  <li
                    key={referral.id}
                    className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-5 py-3.5"
                  >
                    <div className="min-w-0">
                      {/* Masked. You referred them, which does not entitle you to a readable
                          list of your friends' email addresses on a page you might screen-share. */}
                      <div className="truncate text-sm">{mask(referral.refereeEmail)}</div>
                      <div className="text-xs text-muted-foreground">
                        {referral.createdAt.toLocaleDateString(undefined, {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })}
                      </div>
                    </div>

                    <div className={`text-sm ${status.className}`}>
                      {referral.rewardAmount
                        ? `+${formatMoney(referral.rewardAmount, referral.rewardCurrency ?? "usd")}`
                        : status.label}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
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

/** j••••@gmail.com — enough to recognise someone you invited, not enough to be a contact list. */
function mask(email: string | null): string {
  if (!email) return "Someone";

  const [local, domain] = email.split("@");
  if (!domain) return "Someone";

  return `${local.slice(0, 1)}${"•".repeat(Math.max(3, Math.min(local.length - 1, 6)))}@${domain}`;
}
