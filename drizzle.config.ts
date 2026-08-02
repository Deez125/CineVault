import "./lib/load-env";
import { defineConfig } from "drizzle-kit";

/**
 * Migrations are generated as plain SQL files under ./drizzle and committed.
 *
 * We do NOT use `drizzle-kit push` outside local scratch work. Push diffs the schema against
 * a live database and applies whatever it decides; against production that is a destructive
 * operation waiting to happen. Generated SQL is reviewable before it runs.
 */
export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
  strict: true,
  verbose: true,
});
