import { config } from "dotenv";

/**
 * Loads .env.local then .env, for code that runs OUTSIDE Next.js: the CLI scripts, the
 * migration runner, and the background worker.
 *
 * Next.js loads these files itself, so the app never imports this. Anything with its own
 * entry point does, and it must be the FIRST import in that file — ES modules evaluate
 * imports in order, so importing it below something that reads process.env means that thing
 * reads an empty environment.
 *
 * Earlier files win, which is why .env.local is first: it is the developer's local override.
 */
config({ path: [".env.local", ".env"], quiet: true });
