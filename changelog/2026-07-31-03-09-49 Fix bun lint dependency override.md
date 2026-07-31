# Fix bun lint dependency override

Restored the audited `brace-expansion` override so dependency scans continue resolving the patched version required by `bun audit`.

ESLint 10 was tested as a possible no-shim fix. It removes the immediate `@eslint/config-array` / legacy `minimatch` brace-expansion crash, but the current Next.js ESLint stack still brings plugins such as `eslint-plugin-react` that are not compatible with ESLint 10's rule context API, so the upgrade fails during lint startup.

Instead, Primordia now stays on the latest ESLint 9 patch release and uses a Bun package patch for `brace-expansion@5.0.8` so its CommonJS entry remains callable for legacy `minimatch@3` consumers while preserving the audited fixed implementation. This lets `bun run lint` use the normal `eslint .` command and keeps `bun audit` passing without a lint-process shim or vulnerable `brace-expansion` 1.x packages in the lockfile.
