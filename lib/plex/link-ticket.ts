import crypto from "node:crypto";
import { cookies } from "next/headers";
import { env, isProduction } from "@/lib/env";

/**
 * The PIN reference that survives the round trip to Plex.
 *
 * Plex sends the member away to its own sign-in page and forwards them back, so we have to
 * remember which PIN we minted. That memory lives in a cookie, and it is SIGNED and bound to
 * the user who started the flow.
 *
 * Signing is not decoration. If the value could be tampered with, an attacker could hand a
 * victim a link that plants the attacker's own already-authorised PIN. The victim's callback
 * would then attach the ATTACKER'S Plex account to the victim's CineVault account — and since
 * entitlement follows the account, the attacker would be watching on the victim's
 * subscription. Binding to the user id means a stolen ticket is useless to anyone else.
 */

const COOKIE = "cv_plex_link";
const MAX_AGE_SECONDS = 15 * 60;

type Ticket = { pinId: number; userId: string; exp: number };

const sign = (body: string) =>
  crypto.createHmac("sha256", env.SESSION_SECRET).update(body).digest("base64url");

export async function setLinkTicket(pinId: number, userId: string): Promise<void> {
  const payload: Ticket = {
    pinId,
    userId,
    exp: Date.now() + MAX_AGE_SECONDS * 1000,
  };

  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${body}.${sign(body)}`;

  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isProduction,
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/** The PIN this user started, or null if there isn't a valid one. */
export async function readLinkTicket(userId: string): Promise<number | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token || !token.includes(".")) return null;

  const [body, mac] = token.split(".");

  // Constant time. A fast-fail compare leaks how much of the MAC was right.
  const expected = Buffer.from(sign(body));
  const actual = Buffer.from(mac);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Ticket;

    if (payload.exp < Date.now()) return null;
    // The ticket belongs to whoever started the flow, and only to them.
    if (payload.userId !== userId) return null;

    return payload.pinId;
  } catch {
    return null;
  }
}

export async function clearLinkTicket(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
