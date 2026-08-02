import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { env, isProduction } from "@/lib/env";
import * as schema from "./schema";

/**
 * The database connection.
 *
 * One pool per process. In development Next.js reloads modules on every edit, which would
 * otherwise open a new pool each time until Postgres refuses new connections — so the pool is
 * stashed on globalThis and reused across reloads. This is the standard fix and it is only
 * needed in development; production imports this module once.
 */

const globalForDb = globalThis as unknown as { __cinevaultPool?: Pool };

const pool =
  globalForDb.__cinevaultPool ??
  new Pool({
    connectionString: env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

if (!isProduction) globalForDb.__cinevaultPool = pool;

// A pool error with no listener crashes the process. A dropped connection is normal
// (Postgres restarts, a network blip) and the pool recovers on its own, so log and continue.
pool.on("error", (err) => {
  console.error("[db] idle client error:", err.message);
});

export const db = drizzle(pool, { schema });
export { pool, schema };
export * from "./schema";
