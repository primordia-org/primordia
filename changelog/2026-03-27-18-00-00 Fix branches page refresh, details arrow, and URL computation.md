# Fix branches page: remove auto-refresh, clean up UI, fix URL computation

## What changed

### 1. Removed auto-refresh every 3 seconds (`app/branches/page.tsx`)

The branches page was injecting a `<script>` tag that called `setTimeout(() => location.reload(), 3000)`, causing the page to reload every 3 seconds. This made it very difficult to read the diagnostics section. Removed the script entirely and updated the legend text from "Refreshes every 3 s · Development mode only" to "Development mode only".

### 2. Removed redundant `▶` arrow from Diagnostics summary (`app/branches/page.tsx`)

The `<summary>` element for the diagnostics `<details>` block displayed `▶ Diagnostics (…)`. The `▶` is redundant because the browser already renders a built-in disclosure triangle for `<details>`/`<summary>`. Removed it.

### 3. Fixed URL computation to use forwarded headers (`app/branches/page.tsx`, `lib/local-evolve-sessions.ts`, `app/api/evolve/local/route.ts`, `components/EvolveForm.tsx`)

**Root cause:** Several places hardcoded `http://localhost:PORT` as the "current server" URL. When the app runs on exe.dev behind a reverse proxy, the real public URL is determined by `x-forwarded-proto` and `x-forwarded-host` headers, not the internal `localhost` address.

**Branches page — current server URL:**
The branches page was computing `mainServerUrl = http://localhost:PORT` and displaying it for the `main` branch. Two problems:
1. The URL was wrong behind a reverse proxy (should use forwarded headers like `app/api/auth/exe-dev/route.ts` does).
2. The assumption that `main` is the "root" branch was incorrect. Each server instance only knows about sessions it spawned — the **current branch** of this server is the root, not necessarily `main`.

Fixed by:
- Making `BranchesPage` async and calling `headers()` from `next/headers` to read `x-forwarded-proto` and `x-forwarded-host`.
- Computing `currentServerUrl` using the same pattern as `getPublicOrigin` in `app/api/auth/exe-dev/route.ts`.
- Displaying `currentServerUrl` for `node.isCurrent` (the branch this server is checked out on) instead of hardcoding it to `node.name === "main"`.

**Preview server URLs (local evolve sessions):**
`lib/local-evolve-sessions.ts` was setting `session.previewUrl = http://localhost:${port}` when a worktree dev server became ready. Fixed by accepting a `publicHostname` parameter (defaulting to `"localhost"`) and using it in the URL: `http://${publicHostname}:${port}`.

`app/api/evolve/local/route.ts` (POST handler) now extracts the hostname from `x-forwarded-host` (stripping any port suffix) and passes it to `startLocalEvolve`.

**Client-side workaround removed (`components/EvolveForm.tsx`):**
The EvolveForm was working around the localhost URL issue by building the preview URL client-side using `window.location.hostname`. Since the server now stores the correct public URL in `session.previewUrl`, the client can use `data.previewUrl` directly and the workaround is no longer needed.

## Why

- The auto-refresh was disruptive when debugging — the diagnostics panel would collapse/reset before you could read it.
- The redundant `▶` arrow was visually noisy.
- Hardcoded `localhost` URLs don't work when Primordia is deployed to exe.dev, causing preview links to be inaccessible. Fixing it server-side is cleaner than patching it client-side with `window.location`.
- Correctly identifying the "current branch" as the root of each server's session tree (rather than always assuming `main`) ensures the branches page is accurate when deployed from a non-main branch.
