import { redirect } from "next/navigation";
import { verifyEmailToken } from "@/lib/auth/actions";

/**
 * The link from the confirmation email.
 *
 * A route handler rather than a page, and that is not a matter of taste: confirming a signup
 * CREATES the account and signs the person in, and only a route handler or a server action may
 * write the session cookie. As a page this threw on that write — so the link returned a 500
 * *after* the account had been created and the pending row consumed. The visitor saw an error,
 * was not signed in, and clicking again told them the link was dead precisely because it had
 * worked the first time.
 *
 * Success goes straight to the dashboard rather than to a "you may now continue" screen. They
 * are signed in by this point, so the account itself is the confirmation.
 */
export async function GET(request: Request) {
  const token = new URL(request.url).searchParams.get("token");
  const ok = token ? await verifyEmailToken(token) : false;

  redirect(ok ? "/dashboard" : "/verify/expired");
}
