import "../load-env";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";

/**
 * Applies every pending migration in ./drizzle, then exits.
 *
 * Run on deploy, before the app starts serving. Its own pool, closed at the end, so it does
 * not hold a connection open for a container that is about to be replaced.
 */
async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");

  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  console.log("[migrate] applying migrations…");
  await migrate(db, { migrationsFolder: "./drizzle" });
  console.log("[migrate] done");

  await pool.end();
}

main().catch((err) => {
  console.error("[migrate] failed:", err);
  process.exit(1);
});
