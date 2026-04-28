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
Options: **No delay** (0), **1 day**, **3 days**, **1 week** (default-safe option),
**2 weeks**, **1 month**.

The motivation is supply-chain attack resilience. The JavaScript ecosystem has seen
a wave of malicious packages that are discovered only days or weeks after release.
Upstream changes to a Primordia instance are not npm packages, but they are
third-party code that instance owners implicitly trust. A delay of 7 days means
that instead of merging whatever is at the tip of `upstream/main` right now, the
system only surfaces commits whose committer date is at least 7 days old — giving
the community time to discover and report problems before they reach most instances.

Implementation: `git log --before="N days ago" --format=%H -1 <trackingBranch>`
finds the effective tip. The merge-base and ahead-count calculations use this
time-shifted ref rather than the raw branch tip.

## Storage

Both settings are stored in git config alongside the existing update-source
metadata (no database changes):

```
[remote "primordia-official"]
    fetchFrequency  = daily
    fetchDelayDays  = 7
    lastFetchedAt   = 1714300000000
```

## New files

- `lib/update-source-scheduler.ts` — background scheduler (singleton, uses
  `setInterval`, unref'd so it doesn't keep the process alive)
- `instrumentation.ts` — Next.js instrumentation hook that starts the scheduler
  on server boot (Node.js runtime only)

## Modified files

- `lib/update-sources.ts` — new fields `fetchFrequency`, `fetchDelayDays`,
  `lastFetchedAt` on `UpdateSource`; new functions `setSourceSchedule`,
  `setLastFetchedAt`, `getLastFetchedAt`
- `app/api/admin/updates/route.ts` — new `update-source-settings` action; all
  status-building logic now uses the delay-aware `getEffectiveTip()` helper
- `app/admin/updates/UpdatesClient.tsx` — settings panel per source card with
  frequency dropdown, delay dropdown, last-fetched display, and Save button
- `app/admin/updates/page.tsx` — server-side status builder updated to use
  delay-aware helpers
