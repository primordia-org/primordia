# Add admin "Fetch Updates" page

## What changed

Added a new **Fetch Updates** tab to the admin panel at `/admin/updates`.

### New files
- `app/admin/updates/page.tsx` — Server-rendered admin page (auth-gated to admins). Reads source list and initial git status at render time.
- `app/admin/updates/UpdatesClient.tsx` — Interactive client component: per-source cards with fetch/toggle/remove/merge-session actions and an Add Source form.
- `app/api/admin/updates/route.ts` — API route handling all update-source operations (see below).
- `lib/update-sources.ts` — Manages the list of update sources using git config subsections (`primordia-update-source.{id}.*`), the same pattern git uses for `remote.{name}.url`. Ensures the built-in Primordia Official source is always present.

### Modified files
- `components/AdminSubNav.tsx` — Added **Fetch Updates** tab between Git Mirror and Instance.

## How it works

### Multiple update sources
The page supports multiple named update sources, similar to how Linux distros manage package repositories. Sources are persisted in `.git/config` using the `primordia-update-source.{id}.*` subsection pattern — the same mechanism git uses for remotes and branch config.

Example entry in `.git/config`:
```
[primordia-update-source "primordia-updates"]
    name    = Primordia Official
    url     = https://primordia.exe.xyz/api/git
    enabled = true
    builtin = true
```

Each source has:
- A human-readable **name** and **URL** (a read-only git HTTP endpoint)
- A derived **git remote name** (slugified from the name) and **tracking branch** (`<id>-main`)
- An **enabled** flag — disabled sources are skipped by "Fetch All"
- A **builtin** flag — the default Primordia Official source cannot be deleted, only disabled

The built-in source (`primordia-updates`) points at `https://primordia.exe.xyz/api/git`. Custom sources can be any Primordia instance (or compatible git HTTP server) — enabling an ecosystem where people can distribute application layers as update sources.

### Workflow
1. Admin visits `/admin/updates`.
2. **Fetch All Sources** (or per-source fetch) — adds git remotes as needed, fetches each source's `main` → `<id>-main` tracking branch.
3. Per-source cards show ahead commit count and a collapsible list of new `changelog/*.md` entries rendered with `MarkdownContent` (full markdown, not raw text).
4. **Merge** button appears per source when updates are available. Creates a new branch from local `main`, starts an evolve session, and redirects to the session page. Claude merges the tracking branch, resolves conflicts, and verifies the build. Accept as normal.

### API (`/api/admin/updates`)
- `GET` — returns all sources with their current git status
- `POST { action: "fetch-all" }` — fetches all enabled sources
- `POST { action: "fetch-source", sourceId }` — fetches one source
- `POST { action: "add-source", name, url }` — adds a new custom source
- `POST { action: "remove-source", sourceId }` — removes a non-built-in source (also cleans up git remote and tracking branch)
- `POST { action: "toggle-source", sourceId, enabled }` — enables/disables a source
- `POST { action: "create-session", sourceId }` — creates a merge evolve session for the given source

## Why

Primordia instances can diverge from upstream over time. This page gives admins a zero-CLI path to pull in upstream improvements and review them through the normal evolve/accept workflow. Supporting multiple sources enables a future where Primordia acts as a platform — different teams can publish specialised application layers and instance admins can subscribe to whichever ones they want.
