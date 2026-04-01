# List all sessions with port and status in branches diagnostics

## What changed

In the diagnostics `<details>` section on the `/branches` page, a new **evolve sessions** block is now rendered. It displays a table listing every evolve session persisted in SQLite, with columns for:

- **id** — first 8 characters of the session UUID (truncated for readability)
- **branch** — the git branch associated with the session
- **status** — the `LocalSessionStatus` value, coloured using the same `STATUS_COLOR` map used by the branch tree rows
- **port** — the port the preview dev server is listening on, or `—` if not yet assigned

When no sessions exist, a `(none)` placeholder is shown instead of the table.

## Why

Previously the diagnostics section only reported the *count* of active sessions (`X active sessions`), giving no visibility into which sessions existed, what state they were in, or which ports they had claimed. This made it harder to debug stuck or orphaned sessions. The full session list gives a complete at-a-glance picture directly in the diagnostics panel without requiring navigation to individual session pages.
