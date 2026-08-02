import type { Metadata } from "next";
import { Clause, LegalPage } from "@/components/site/legal-page";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Terms of Service" };

/**
 * A plain-English draft. Not written by a lawyer, and worth having one read it before you
 * take real money in a jurisdiction that cares. The support address and governing law are
 * placeholders that need to be filled in.
 */
export default async function TermsPage() {
  const user = await getSessionUser();

  return (
    <LegalPage user={user} title="Terms of Service" updated="2 August 2026">
      <Clause heading="What this is">
        <p>
          CineVault gives you access to a privately run media server. Your plan sets how many
          people can watch at the same time. A 2 user plan means two simultaneous streams, and
          so on.
        </p>
        <p>
          Access is personal to you and the people in your household. You may not resell it,
          share your account outside your household, or hand your login to anyone else.
        </p>
      </Clause>

      <Clause heading="Your account">
        <p>
          You need an account to subscribe. Keep your password to yourself, and tell us if you
          think somebody else has it. You are responsible for what happens under your account.
        </p>
        <p>
          To watch anything you also link a Plex account. One Plex account can be linked to one
          CineVault account at a time.
        </p>
      </Clause>

      <Clause heading="Payment">
        <p>
          Plans are billed monthly in advance through Stripe. Your subscription renews
          automatically until you cancel. Prices are shown on the site before you pay, and we
          will tell you before any price change affects you.
        </p>
        <p>
          If you change plans mid-month the difference is prorated and settled on your next
          invoice. If a payment fails, Stripe retries it, and we keep your access on while it
          does. If it keeps failing your access ends.
        </p>
      </Clause>

      <Clause heading="Cancelling">
        <p>
          Cancel any time from your billing page. You keep access until the end of the period
          you have already paid for, and you are not charged again. We do not give partial
          refunds for time you did not use, but if something has genuinely gone wrong, get in
          touch and we will sort it out.
        </p>
      </Clause>

      <Clause heading="Fair use">
        <p>Do not:</p>
        <ul className="ml-5 list-disc space-y-1">
          <li>share your account or your Plex login with people outside your household</li>
          <li>try to exceed the number of simultaneous streams your plan allows</li>
          <li>download, copy, or redistribute anything from the server</li>
          <li>attempt to break, overload, or gain extra access to the service</li>
        </ul>
        <p>
          We monitor simultaneous streams to enforce plan limits. If you go over, the extra
          stream may be stopped.
        </p>
      </Clause>

      <Clause heading="Suspension">
        <p>
          We may suspend or close an account that breaks these terms, that is being used
          fraudulently, or where a payment has been charged back. Where it is reasonable to do
          so, we will tell you why first.
        </p>
      </Clause>

      <Clause heading="Availability">
        <p>
          This is a small, privately run service, not an enterprise platform. It may be
          unavailable for maintenance, hardware problems, or reasons outside our control. We
          do not guarantee uptime, and specific content may be added or removed at any time.
        </p>
        <p>
          The service is provided as is. To the extent the law allows, we are not liable for
          indirect or consequential loss, and our total liability to you is limited to what you
          paid us in the previous twelve months.
        </p>
      </Clause>

      <Clause heading="Changes">
        <p>
          We may update these terms. If a change materially affects you we will give you
          reasonable notice, and continuing to use the service after it takes effect means you
          accept it.
        </p>
      </Clause>

      <Clause heading="Contact">
        <p>Questions about these terms: support@getcinevault.com</p>
      </Clause>
    </LegalPage>
  );
}
