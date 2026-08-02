import crypto from "node:crypto";
import { promisify } from "node:util";

/**
 * Password hashing with scrypt.
 *
 * scrypt is in Node's standard library, is memory-hard (so GPU cracking is expensive), and
 * needs no native module — which matters because argon2 and bcrypt both ship compiled
 * binaries that break in Alpine containers at the worst moment. One less thing to go wrong on
 * a deploy.
 *
 * Stored format:  scrypt$N$r$p$<salt base64>$<hash base64>
 *
 * The parameters travel WITH the hash. When we raise the cost later, existing hashes keep
 * verifying against their own parameters and get upgraded on next sign-in, rather than
 * locking everyone out.
 */

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

/** ~16MB of memory per hash (128 * N * r). Comfortably under Node's 32MB default cap. */
const PARAMS = { N: 16384, r: 8, p: 1 } as const;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

// Defined in a browser-safe module because client forms need it; re-exported here so
// server code has one place to import auth things from.
export { MIN_PASSWORD_LENGTH } from "./constants";

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(SALT_LENGTH);
  const derived = await scrypt(normalize(password), salt, KEY_LENGTH, {
    ...PARAMS,
    maxmem: 64 * 1024 * 1024,
  });

  return [
    "scrypt",
    PARAMS.N,
    PARAMS.r,
    PARAMS.p,
    salt.toString("base64"),
    derived.toString("base64"),
  ].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, nRaw, rRaw, pRaw, saltB64, hashB64] = parts;
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return false;

  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");

  let derived: Buffer;
  try {
    derived = await scrypt(normalize(password), salt, expected.length, {
      N,
      r,
      p,
      maxmem: 256 * 1024 * 1024,
    });
  } catch {
    // Corrupt or hostile parameters (an absurd N would otherwise throw and 500 the login).
    return false;
  }

  // Constant time. A fast-fail compare leaks how much of the hash was right, one byte at a
  // time, which is enough to reconstruct it.
  if (derived.length !== expected.length) return false;
  return crypto.timingSafeEqual(derived, expected);
}

/**
 * Burn roughly the time a real verification takes, then fail.
 *
 * Call this when the email doesn't exist. Without it, "no such user" returns in a
 * millisecond and "wrong password" takes a hundred, so anyone can discover which emails have
 * accounts here by timing the responses. Which emails have a paid Plex subscription is not
 * something we should be handing out.
 */
export async function fakeVerify(): Promise<false> {
  await scrypt("cinevault-timing-equaliser", crypto.randomBytes(SALT_LENGTH), KEY_LENGTH, {
    ...PARAMS,
    maxmem: 64 * 1024 * 1024,
  });
  return false;
}

/** True when a hash was made with older parameters and should be re-hashed on next sign-in. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return true;
  return Number(parts[1]) < PARAMS.N || Number(parts[2]) < PARAMS.r;
}

/**
 * Unicode normalisation.
 *
 * "café" can be typed as five code points or six. Both look identical, and without this a
 * password set on a Mac can fail to verify from Windows. Normalise on the way in and on the
 * way out and the two agree.
 */
function normalize(password: string): string {
  return password.normalize("NFKC");
}
