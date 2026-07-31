# Fix bun lint dependency override

Restored the audited `brace-expansion` override so dependency scans continue resolving the patched version required by `bun audit`.

ESLint 10 was tested as a possible no-shim fix. It removes the immediate `@eslint/config-array` / legacy `minimatch` brace-expansion crash, but the current Next.js ESLint stack still brings plugins such as `eslint-plugin-react` that are not compatible with ESLint 10's rule context API, so the upgrade fails during lint startup.

The full currently published Next.js lint stack was also tested (`next@16.2.12`, `eslint-config-next@16.2.12`, `@next/eslint-plugin-next@16.2.12`, and their latest plugin dependencies) together with `eslint@10.8.0`. `bun audit` passed, but lint still failed on `eslint-plugin-react`; its latest release declares support only through ESLint 9 and throws `contextOrFilename.getFilename is not a function` under ESLint 10. So there is not yet an upstream-only ESLint 10 path for this project.

Instead, Primordia now stays on the latest ESLint 9 patch release and uses a Bun package patch for `brace-expansion@5.0.8` so its CommonJS entry remains callable for legacy `minimatch@3` consumers while preserving the audited fixed implementation. This lets `bun run lint` use the normal `eslint .` command and keeps `bun audit` passing without a lint-process shim or vulnerable `brace-expansion` 1.x packages in the lockfile.
