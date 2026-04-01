# Lazy-load changelog entry details at runtime

## What changed

- **`app/changelog/page.tsx`** — rewritten to read `changelog/` filenames directly from the filesystem at page-render time instead of consuming a pre-generated `public/changelog.json`. Only filenames are read on the initial request; file bodies are not touched until a user expands an entry.
- **`components/ChangelogEntryDetails.tsx`** — new client component. Renders the `<details>`/`<summary>` widget for one changelog entry. On the first `toggle` open event it fetches `/api/changelog?filename=...` and renders the body with `<MarkdownContent>`. Subsequent opens reuse the cached state. While the fetch is in-flight, the expand arrow is replaced with a spinning indicator.
- **`app/api/changelog/route.ts`** — new GET route. Accepts `?filename=` (validated against the expected timestamp pattern to prevent path traversal), reads the corresponding `changelog/*.md` file, and returns its raw text.
- **`scripts/generate-changelog.mjs`** — removed `public/changelog.json` generation. The script now only produces `lib/generated/system-prompt.ts` (chat system prompt with last 30 changelog filenames baked in).
- **`scripts/watch-changelog.mjs`** — updated comment to drop the `changelog.json` reference.
- **`PRIMORDIA.md`** — file map and changelog section updated to reflect the new runtime approach.

## Why

Previously the changelog page required a prebuild step to generate `public/changelog.json`. This meant the page was stale until the next build and added unnecessary CI/deploy friction. Now the page works correctly on a fresh clone with no build artifacts, simply by reading the `changelog/` directory at request time.

The lazy-loading optimisation keeps the page fast at scale: visiting `/changelog` only costs a single `readdir` syscall. File bodies — potentially large markdown documents — are fetched individually and only when the user actually opens an entry.
