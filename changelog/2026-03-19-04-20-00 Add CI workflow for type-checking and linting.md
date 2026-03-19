# Add CI workflow for type-checking and linting

## What changed

- Added `.github/workflows/ci.yml`: a GitHub Actions workflow that runs on every pull request to `main`, installing dependencies with Bun (frozen lockfile), running the prebuild script, then executing `tsc --noEmit` and `eslint .` to enforce type safety and code quality before merge.
- Added `eslint.config.mjs`: ESLint flat config using `@eslint/eslintrc` to extend the Next.js core-web-vitals ruleset.
- Updated `next.config.ts`: set `typescript.ignoreBuildErrors: true` and `eslint.ignoreDuringBuilds: true` so Vercel production builds skip these checks (they are now enforced in CI instead).
- Updated `package.json`: added a `typecheck` script (`tsc --noEmit`) and switched from `package-lock.json` to `bun.lock` as the canonical lockfile.
- Deleted `package-lock.json`: replaced by `bun.lock` following the project's switch to Bun as the default package manager.

## Why

Type-checking and linting during `next build` slows down every Vercel deployment. Moving these checks into a dedicated CI workflow means Vercel builds stay fast while code quality is still enforced on every PR before it can reach `main`. The Blacksmith runner issue noted in the PR comments is an account-level infra concern separate from this change.
