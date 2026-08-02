/**
 * Auth constants, safe for the browser.
 *
 * Deliberately its own file with NO imports. These live apart from lib/auth/password.ts
 * because that module uses node:crypto and util.promisify — and a client component importing
 * a single number from it pulls scrypt into the browser bundle, where promisify is handed
 * something that is not a function and the page dies on
 * `The "original" argument must be of type Function`.
 *
 * The symptom is nothing like the cause, which is exactly why this file exists: anything a
 * "use client" file needs goes here, and anything that does real crypto stays next door.
 */

/** Minimum password length, used by the forms and by validation. */
export const MIN_PASSWORD_LENGTH = 10;
