# Make proxy magic numbers configurable in admin UI

Two key proxy behaviours that were previously hardcoded are now configurable
directly from the **Server Health** admin page:

- **Disk auto-cleanup threshold** (default: 90%) — automatic worktree cleanup kicks
  in when disk usage reaches this percentage. Slider embedded in the Disk section.
- **Preview server inactivity timeout** (default: 30 minutes) — idle preview dev
  servers are stopped after this many minutes of inactivity. Slider embedded in the
  Memory section.

Both sliders save automatically 500 ms after release and show a brief "Saved"
confirmation. The reverse proxy picks up changes within seconds via its existing
git config file-watcher — no restart needed.

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

### `components/AdminServerHealthClient.tsx`
- Fetches proxy settings alongside health data on load.
- Disk section: range slider (50–99%) for the auto-cleanup threshold, embedded
  below the usage bar inside the existing card.
- Memory section: range slider (5–240 min, step 5) for the preview inactivity
  timeout, embedded below the usage bar inside the existing card.
- Both sliders debounce saves by 500 ms and show a shared "Saving…" / "Saved" /
  "Save failed" indicator next to the value.
- `UsageBar` colour thresholds now scale relative to the configured disk threshold.

## Why

The 30-minute preview inactivity timeout and 90% disk cleanup threshold were
hardcoded constants in the proxy. Operators running Primordia on machines with
different disk sizes or usage patterns had no way to tune them without editing
source code. Storing them in git config means the proxy reloads them live via its
existing file-watcher, and embedding the controls directly in the Server Health
page keeps the admin UI focused without adding a new tab.
