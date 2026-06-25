# Prefer absolute import paths

Updated the coding style guidance to disallow parent-directory import paths that start with `../` and prefer the existing `@/` alias for parent or cross-directory imports. Added an ESLint `no-restricted-imports` rule so new `../` imports are caught during linting while same-directory `./` imports remain allowed.

Rewrote existing TypeScript imports that used `../` across app routes, components, shared libraries, scripts, and tests to use `@/` paths instead. This keeps import paths stable when files move and makes cross-directory dependencies easier to read.
