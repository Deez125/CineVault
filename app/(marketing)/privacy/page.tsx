import type { Metadata } from "next";
import { Clause, LegalPage } from "@/components/site/legal-page";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Privacy Policy" };

/**
 * A plain-English draft describing what the system ACTUALLY stores. Kept in step with the
 * database schema deliberately: a privacy policy that drifts from the code is worse than none,
 * because it is a confident description of something that is not true.
 */
export default async function PrivacyPage() {
  const user = await getSessionUser();

  return (
    <LegalPage user={user} title="Privacy Policy" updated="2 August 2026">
      <Clause heading="The short version">
        <p>
          We store the minimum needed to bill you and give you access: your email, your Plex
          username, and a record of your subscription. We never see your card number and we
          never see your Plex password. We do not sell anything to anybody.
        </p>
      </Clause>

      <Clause heading="What we store">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <b className="text-foreground">Your email address</b>, and a display name if you set
            one.
          </li>
          <li>
            <b className="text-foreground">Your password, hashed.</b> It is put through scrypt
            and cannot be read back, by us or by anyone who obtained the database.
          </li>
          <li>
            <b className="text-foreground">Your Plex username, email and user id</b>, once you
            link an account, so we know who to share the libraries with.
          </li>
          <li>
            <b className="text-foreground">Stripe identifiers</b> for your customer and
            subscription, plus a copy of your plan, its price, and its renewal date.
          </li>
          <li>
            <b className="text-foreground">Sessions</b>, including the IP address and browser
            you signed in from, so you can see and end them.
          </li>
          <li>
            <b className="text-foreground">An activity log</b> of things that changed your
            access: subscribing, changing plan, cancelling, linking Plex, being granted or
            losing access.
          </li>
          <li>
            <b className="text-foreground">Streaming activity</b> while you watch, limited to
            what is needed to enforce your plan&apos;s simultaneous stream limit.
          </li>
        </ul>
      </Clause>

      <Clause heading="What we never store">
        <ul className="ml-5 list-disc space-y-1.5">
          <li>
            <b className="text-foreground">Your card details.</b> Payment happens inside
            Stripe&apos;s own form. Card numbers never reach our servers. We only ever see the
            brand, last four digits and expiry.
          </li>
          <li>
            <b className="text-foreground">Your Plex password.</b> Linking uses Plex&apos;s own
            code flow, so you type your password at plex.tv and never here.
          </li>
          <li>
            <b className="text-foreground">Your Plex token.</b> It is read once during linking,
            purely to learn your username, and then discarded.
          </li>
        </ul>
      </Clause>

      <Clause heading="Who else sees it">
        <p>
          <b className="text-foreground">Stripe</b> handles payments and holds your billing
          details under their own privacy policy.
        </p>
        <p>
          <b className="text-foreground">Plex</b> receives your Plex account identifier so the
          libraries can be shared with you, which is how their sharing works.
        </p>
        <p>
          Nobody else. We do not sell, rent, or share your information with advertisers or data
          brokers, and there is no third-party analytics or tracking on this site.
        </p>
      </Clause>

      <Clause heading="How long we keep it">
        <p>
          Your account details for as long as you have an account. Delete your account and the
          record is removed: your subscription is cancelled, your Plex access is revoked, and
          your row is deleted.
        </p>
        <p>
          Two things outlive that on purpose. The activity log keeps a record that an action
          happened, with your email attached, because a log that disappears when an account
          does cannot answer questions about billing disputes. Stripe keeps its own payment
          records for as long as their financial and tax obligations require.
        </p>
      </Clause>

      <Clause heading="Your choices">
        <p>
          You can change your email or password, see what we hold, and delete your account
          entirely, all from your settings page. If you want a copy of your data or want
          something corrected, ask and we will do it.
        </p>
      </Clause>

      <Clause heading="Cookies">
        <p>
          One cookie, for keeping you signed in. There are no advertising or tracking cookies
          on this site.
        </p>
      </Clause>

      <Clause heading="Contact">
        <p>Questions about your data: support@getcinevault.com</p>
      </Clause>
    </LegalPage>
  );
}
