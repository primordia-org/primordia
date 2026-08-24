# Document Core API migration status

Added `docs/core-migration.md` to track the current migration away from Next.js-owned API routes toward Primordia Core.

The document identifies which thread and server endpoints already have Core command or shared-library equivalents, calls out the remaining thread-page blockers such as diff summary, per-file diffs, attachments, streaming events, abort/reset-stuck, models, presets, and initial page bootstrap data, and summarizes the wider `/app/api` areas that still need Core replacements before Primordia can support static SPA, Expo, and other frontends without depending on Next.js.

Follow-up: added an install-time prune for incompatible Linux libc native binary packages. Bun installs both glibc and musl optional packages for the Claude Agent SDK and Next.js SWC because it filters native optional dependencies by OS/CPU but not libc-specific package metadata/naming; the postinstall step removes the unused fallback so installs keep only the binary for the current runtime.
