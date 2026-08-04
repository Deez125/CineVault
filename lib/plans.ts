/**
 * How many things somebody may watch at once, and how to say it.
 *
 * IMPORTS NOTHING, ON PURPOSE. Client components render these, and a module they import must
 * not drag server-side code into the browser bundle. See lib/money.ts for the same rule and
 * the errors that ignoring it produces.
 */

/**
 * An admin's stream allowance.
 *
 * A sentinel rather than a big number, because "999" would eventually be rendered somewhere
 * as "999 streams" and read as a bug. Anything comparing against a limit must check for this
 * FIRST — `used > limit` is false for -1 by luck rather than by intent, and luck is not what
 * you want deciding whether to kill somebody's stream.
 */
export const UNLIMITED_STREAMS = -1;

export function isUnlimited(streamLimit: number): boolean {
  return streamLimit === UNLIMITED_STREAMS;
}

/** "Unlimited", "1 stream", "3 streams". */
export function formatStreamLimit(streamLimit: number): string {
  if (isUnlimited(streamLimit)) return "Unlimited";
  return `${streamLimit} stream${streamLimit === 1 ? "" : "s"}`;
}

/** True when this many concurrent streams is more than the allowance permits. */
export function overLimit(active: number, streamLimit: number): boolean {
  if (isUnlimited(streamLimit)) return false;
  return active > streamLimit;
}
