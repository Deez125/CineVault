import Link from "next/link";
import type { Metadata } from "next";
import { LifeBuoy } from "lucide-react";
import { SiteHeader } from "@/components/site/site-header";
import { getSessionUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Help" };

/**
 * Placeholder until the ticket system is built.
 *
 * Deliberately does not promise a response time or an address we can't answer. Saying
 * "coming soon" honestly is better than publishing a support channel nobody reads.
 */
export default async function HelpPage() {
  const user = await getSessionUser();

  const faqs = [
    {
      q: "How do I start watching?",
      a: "Pick a plan, then link your Plex account from the Plex page in your dashboard. You'll get an invite in Plex, and once you accept it the libraries appear in your account at app.plex.tv.",
    },
    {
      q: "What does a plan actually get me?",
      a: "The number of people who can watch at the same time. A 2 user plan means two streams at once, on any devices, anywhere.",
    },
    {
      q: "Can I change plans later?",
      a: "Any time, from the Billing page. The difference is prorated, so you only pay for what you use, and your access changes straight away.",
    },
    {
      q: "What happens if I cancel?",
      a: "You keep watching until the end of the period you've already paid for. After that your access is removed. You can come back whenever you like.",
    },
    {
      q: "I linked the wrong Plex account.",
      a: "Unlink it on the Plex page and link the right one. Your subscription isn't affected.",
    },
  ];

  return (
    <>
      <SiteHeader user={user} />

      <main className="mx-auto max-w-2xl px-6 py-16">
        <div className="flex items-center gap-3">
          <span className="flex size-10 items-center justify-center rounded-lg bg-muted">
            <LifeBuoy className="size-5 text-muted-foreground" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight">Help</h1>
        </div>

        <dl className="mt-10 divide-y rounded-xl border bg-card">
          {faqs.map((faq) => (
            <div key={faq.q} className="p-5">
              <dt className="font-medium">{faq.q}</dt>
              <dd className="mt-1.5 text-sm leading-relaxed text-muted-foreground">{faq.a}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-8 rounded-xl border border-dashed bg-card/50 p-5 text-sm text-muted-foreground">
          <p className="font-medium text-foreground">Still stuck?</p>
          <p className="mt-1">
            Support tickets are coming soon. Until then, reach out however you normally get
            hold of us and we&apos;ll sort it out.
          </p>
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">
          <Link href="/" className="underline underline-offset-2 hover:text-foreground">
            Back to the plans
          </Link>
        </p>
      </main>
    </>
  );
}
