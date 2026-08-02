import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",

    // Reference material from the previous build, including its committed .next output.
    // Read-only, deleted once the rebuild is done, and it accounts for every lint error in
    // the project if left in — which makes the lint result useless for spotting our own.
    // ESLint does not read .gitignore, so this has to be said here as well.
    "REF/**",
  ]),
]);

export default eslintConfig;
