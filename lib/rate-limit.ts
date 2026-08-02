/**
 * A small fixed-window rate limiter.
 *
 * In memory, which means it is per-process: two app containers each allow the full quota, and
 * a restart forgets everything. That is a real limitation and it is accepted deliberately —
 * the job here is to stop someone spraying a million password guesses at one account, and it
 * does that fine. It is NOT a defence against a distributed attack, and it should not be
 * mistaken for one.
 *
 * If this ever needs to be shared across processes, move the counters into Postgres or Redis.
 * The interface is meant to survive that change.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/** Stop unbounded growth from an attacker cycling keys. */
const MAX_KEYS = 10_000;

export type RateLimitResult = {
  allowed: boolean;
  /** How long until the window resets, in seconds. Zero when allowed. */
  retryAfter: number;
};

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    if (buckets.size >= MAX_KEYS) sweep(now);
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfter: 0 };
  }

  if (existing.count >= limit) {
    return { allowed: false, retryAfter: Math.ceil((existing.resetAt - now) / 1000) };
  }

  existing.count += 1;
  return { allowed: true, retryAfter: 0 };
}

/** Forget a key. Called after a successful sign-in so one typo doesn't cost a lockout. */
export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

function sweep(now: number): void {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  // Still full of live buckets: drop the oldest rather than refuse to serve anyone.
  if (buckets.size >= MAX_KEYS) {
    const oldest = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (const [key] of oldest.slice(0, Math.floor(MAX_KEYS / 4))) buckets.delete(key);
  }
}
