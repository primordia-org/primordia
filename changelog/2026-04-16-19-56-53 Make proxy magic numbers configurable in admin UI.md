# Make proxy magic numbers configurable in admin UI

Added a new **Proxy Settings** admin page that lets admins tune two key proxy
behaviours that were previously hardcoded:

- **Preview server inactivity timeout** (default: 30 minutes) — idle preview dev
  servers are stopped after this many minutes of inactivity.
- **Disk cleanup threshold** (default: 90%) — automatic worktree cleanup kicks in
  when disk usage reaches this percentage.

## What changed

### `scripts/reverse-proxy.ts`
- `DISK_CLEANUP_THRESHOLD_PCT` changed from a `const` to a `let` variable
  (`diskCleanupThresholdPct`).
- `PREVIEW_INACTIVITY_MS` replaced by a `let previewInactivityMin` variable; all
  uses derive milliseconds at call-time.
- `readAllPorts()` (triggered on every git config change) now also reads
  `primordia.previewInactivityMin` and `primordia.diskCleanupThresholdPct` from git
  config, so the proxy picks up admin changes within seconds without a restart.
- Inactivity log message now prints the configured number of minutes rather than the
  hardcoded string "30 min".

### `app/api/admin/proxy-settings/route.ts` *(new)*
- `GET` — returns current values (or defaults if not yet configured).
- `PATCH` — validates and writes values to git config under `primordia.*` namespace.

### `app/admin/proxy-settings/page.tsx` *(new)*
- New admin page (server component) at `/admin/proxy-settings`.

### `components/AdminProxySettingsClient.tsx` *(new)*
- Client-side form with two numeric inputs; submits a `PATCH` to the API and shows
  confirmation or error inline.

### `components/AdminSubNav.tsx`
- Added **Proxy Settings** tab to the admin navigation.

### `components/AdminServerHealthClient.tsx`
- Server Health page now fetches the current disk cleanup threshold from the proxy
  settings API and shows the live value (e.g. "drops below 85%") instead of the
  hardcoded "90%".
- `UsageBar` colour thresholds now scale relative to the configured disk threshold.
- Added a link to the Proxy Settings page next to the threshold description.

## Why

The 30-minute preview inactivity timeout and 90% disk cleanup threshold were
hardcoded constants in the proxy. Operators running Primordia on machines with
different disk sizes or usage patterns had no way to tune them without editing
source code. Storing them in git config means the proxy reloads them live via its
existing file-watcher, and the admin UI provides a safe, validated editing surface.
