import { redirect } from "next/navigation";

/**
 * Legacy verify link handler.
 *
 * Under the previous auth this route claimed a `?token=…` from `email_tokens`, created the
 * account and signed the person in. Supabase Auth handles all of that itself now — the link
 * lives at `https://<project>.supabase.co/auth/v1/verify?…` and Supabase redirects the visitor
 * to `/auth/callback` after confirming.
 *
 * Kept as a redirect so that any old-format link still in the wild lands on the callback
 * anyway, where Supabase will refuse the missing code and the visitor lands on /login with a
 * friendly explanation rather than a 404.
 */
export async function GET(request: Request) {
  const url = new URL("/auth/callback", request.url);
  return Response.redirect(url.toString(), 307);
}
