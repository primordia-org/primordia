# Standardize page titles

## What changed

Added `lib/page-title.ts` — a small utility function `buildPageTitle(pageName)` that produces consistent `<title>` values across all pages.

Updated the following pages to use `generateMetadata()` (dynamic metadata) backed by this utility:

- **Branches** (`app/branches/page.tsx`) — title was missing; now added
- **Changelog** (`app/changelog/page.tsx`) — replaced static `metadata` export
- **Chat** (`app/chat/page.tsx`) — title was missing; now added
- **Evolve** (`app/evolve/page.tsx`) — replaced static `metadata` export
- **Login** (`app/login/page.tsx`) — title was missing; now added

## Format

| Context | Title |
|---|---|
| Main branch | `{PageName} — Primordia` |
| Any other branch | `{PageName} — Primordia — :{port} - {branch}` |

Example on a preview worktree running on port 3001:

```
Evolve — Primordia — :3001 - evolve/markdown-list-spacing-fix
```

## Why

Page titles were inconsistent — some pages had custom titles, some fell back to the layout default ("Primordia"), and none included port/branch context useful during local development with multiple worktrees running simultaneously. The new format makes it immediately clear in the browser tab which page you're on and which worktree/branch it belongs to.
