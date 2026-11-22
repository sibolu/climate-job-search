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
    // Worker worktrees (Agent tool, isolation: worktree) are full checkouts.
    ".claude/**",
    // The design handoff ships a prototype runtime (support.js) that is read
    // as a spec, never imported (technical-plan.md D37).
    "docs/**",
  ]),
]);

export default eslintConfig;
