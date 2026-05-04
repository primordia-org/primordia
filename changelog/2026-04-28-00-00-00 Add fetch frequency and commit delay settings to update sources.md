# Add fetch frequency and commit delay settings to update sources

## What changed

Each update source in the **Fetch Updates** admin panel now has two new per-source
settings, accessible via the ⚙ (settings) button on each source card:

### Auto-fetch frequency

Controls how often the background scheduler automatically fetches new commits from
the upstream remote. Options: **Never** (default), **Every hour**, **Every day**,
**Every week**.

The scheduler starts automatically when the Next.js server boots (via
`instrumentation.ts`) and wakes up every 5 minutes to check whether any source is
due for a fetch. It only runs `git fetch` — no changes are auto-applied; that
decision is still made manually by an admin. The timestamp of the last successful
auto-fetch is recorded in git config (`remote.{id}.lastFetchedAt`) and shown in
the settings panel.

### Commit delay (safety buffer)

Determines how old a commit must be before it is surfaced as an "available update".
Options: **No delay** (0), **1 day**, **3 days**, **1 week**, **2 weeks**, **1 month**.

The motivation is supply-chain attack resilience. The JavaScript ecosystem has seen
a wave of malicious packages that are discovered only days or weeks after release.
Upstream changes to a Primordia instance are not npm packages, but they are
third-party code that instance owners implicitly trust. A delay of 7 days means
that instead of tracking `upstream/main` directly, the tracking branch is only
advanced to commits that are at least 7 days old — giving the community time to
discover and report problems before they reach most instances.

**The delay is applied at fetch time**, not at read time. When `fetchSourceUpdates`
runs (whether triggered manually or by the scheduler):

1. Full upstream is fetched to a temporary staging branch (`{trackingBranch}-incoming`).
2. `git log --before="N days ago" -1 <staging-branch>` finds the most recent commit
   old enough to be safe.
3. The real tracking branch is force-updated to that commit.
4. The staging branch is deleted.

This means the tracking branch always points to the safe tip with no
post-processing needed elsewhere. All status checks (`buildSourceStatus`, merge
session creation) use the tracking branch directly, with no `getEffectiveTip`
helper required. If all upstream commits are newer than the delay window, the
tracking branch is left where it is — it already holds the last safe commit from a
previous fetch.

## Storage

Both settings are stored in git config alongside the existing update-source
metadata (no database changes):

```
[remote "primordia-official"]
    fetchFrequency  = daily
    fetchDelayDays  = 7
    lastFetchedAt   = 1714300000000
```

## Turbopack fix

Added all `@mariozechner/*` sub-packages (`pi-tui`, `pi-agent-core`, `jiti`,
`clipboard-linux-x64-gnu`, `clipboard-linux-x64-musl`) to `serverExternalPackages`
in `next.config.ts`. Turbopack was generating content-hashed internal identifiers
for these transitive dependencies and then failing to resolve them at runtime.
Listing them all as externals prevents Turbopack from trying to bundle them.

## New files

- `lib/update-source-scheduler.ts` — background scheduler (singleton, uses
  `setInterval`, unref'd so it doesn't keep the process alive)
- `instrumentation.ts` — Next.js instrumentation hook that starts the scheduler
  on server boot (Node.js runtime only)

## Modified files

- `lib/update-sources.ts` — new fields `fetchFrequency`, `fetchDelayDays`,
  `lastFetchedAt` on `UpdateSource`; new functions `setSourceSchedule`,
  `setLastFetchedAt`, `getLastFetchedAt`, `fetchSourceUpdates` (delay-at-fetch logic)
- `app/api/admin/updates/route.ts` — new `update-source-settings` action; uses
  `fetchSourceUpdates` for all fetch operations; `buildSourceStatus` is now a
  simple direct comparison with no delay post-processing
- `app/admin/updates/UpdatesClient.tsx` — settings panel per source card with
  frequency dropdown, delay dropdown, last-fetched display, and Save button
- `app/admin/updates/page.tsx` — server-side status builder simplified
- `next.config.ts` — expanded `serverExternalPackages` to include all
  `@mariozechner/*` sub-packages
