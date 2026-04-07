# Add NEXT_BASE_PATH support

## What changed

The app can now be hosted at a URL sub-path (e.g. `https://example.com/primordia`) instead of always assuming it runs at the root (`/`).

### New env variable: `NEXT_BASE_PATH`

Set `NEXT_BASE_PATH=/your-prefix` in `.env.local` to mount the app at a non-root path. Leave it unset (or empty) to keep the current root-path behaviour — this is a fully backwards-compatible change.

### How it works

- **`next.config.ts`** — reads `NEXT_BASE_PATH` and passes it to Next.js as `basePath`. This makes all Next.js routing (page navigation, server redirects) automatically prefix routes with the base path. Also exposes the value as `NEXT_PUBLIC_BASE_PATH` so client-side code can read it.
- **`lib/base-path.ts`** (new) — exports `basePath` (the configured prefix, or `""`) and `withBasePath(path)` (concatenates the prefix). This is the single source of truth for all client-side path construction.
- **All client components** — every `fetch("/api/...")` call, `<a href="/api/...">` attribute, and `<img src="/api/...">` attribute has been updated to use `withBasePath(...)`. Next.js `<Link>`, `router.push()`, and `redirect()` already handle basePath automatically and were left unchanged.
- **`app/api/auth/exe-dev/route.ts`** — the server-side callback URL passed to the exe.dev proxy is now prefixed with `NEXT_BASE_PATH` so the round-trip redirect lands at the correct route when hosted at a sub-path.
- **`.env.example`** — documents the new optional `NEXT_BASE_PATH` variable.

## Why

When hosting multiple apps under the same domain behind a reverse proxy (e.g. nginx `location /primordia { proxy_pass ... }`), each app must serve all its assets and API calls relative to its sub-path. Without this change Primordia assumed `/` as the root, causing 404s for all API calls and broken navigation when mounted at a prefix.
