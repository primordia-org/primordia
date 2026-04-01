# Fix inaccurate file listing in PRIMORDIA.md

## What changed

Updated the **File Map** section in `PRIMORDIA.md` to reflect the actual state of the repository. The previous listing was missing many files that had been added over time.

### Files added to the map

**Root level:**
- `README.md`, `LICENSE`, `eslint.config.mjs`

**`scripts/`:**
- `watch-changelog.mjs` — dev-mode watcher that re-runs `generate-changelog.mjs` on changelog file changes
- `install-service.sh` — installs/re-installs the Primordia systemd service via symlink
- `primordia.service` — systemd service unit file

**`lib/`:**
- `hooks.ts` — shared React hooks (`useSessionUser`)
- `page-title.ts` — `buildPageTitle()` utility for formatting page `<title>` with branch/port suffix

**`app/`:**
- `app/chat/page.tsx` — the actual chat page (moved from root `page.tsx` to allow the landing page at `/`)
- `app/login/LoginClient.tsx` — client component for passkey register/login UI and QR polling
- `app/api/auth/exe-dev/route.ts` — exe.dev SSO login via injected `X-ExeDev-Email` header
- `app/api/prune-branches/route.ts` — SSE endpoint to delete all local branches merged into main

**`components/`:**
- `HamburgerMenu.tsx` — reusable hamburger button + dropdown
- `LandingNav.tsx` — landing page navbar with mobile hamburger collapse
- `PageNavBar.tsx` — shared nav header for `/changelog` and `/branches`
- `PruneBranchesButton.tsx` — client trigger for `PruneBranchesDialog`
- `PruneBranchesDialog.tsx` — wraps `StreamingDialog` for the prune-branches action
- `SimpleMarkdown.tsx` — minimal markdown renderer (bold, links, inline code, code blocks)
- `StreamingDialog.tsx` — generic SSE-streaming modal (used by git-sync, prune-branches, etc.)

### Description corrections

- `app/page.tsx` — updated description from "Entry point — renders \<ChatInterface\>" to "Landing page — marketing/feature overview; links to /chat and /evolve" (the chat moved to `/chat`)
- `app/login/page.tsx` — clarified it is the server shell; the interactive UI is in `LoginClient.tsx`
- `components/GitSyncDialog.tsx` — noted it wraps `StreamingDialog`

## Why

The File Map in `PRIMORDIA.md` is used by Claude Code to understand the codebase at the start of every session. An inaccurate map causes Claude to miss existing files, duplicate work, or make incorrect assumptions about the app's structure. This change keeps the map as the reliable source of truth it is intended to be.
