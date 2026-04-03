# Abort button works during type-fixing

## What changed

- The **Abort** button now appears and works when a session is in the `fixing-types` state (i.e. Claude is auto-fixing TypeScript/build errors after an Accept attempt).
- The abort API route (`POST /api/evolve/abort`) now accepts sessions with status `fixing-types` in addition to `starting` and `running-claude`.
- `isClaudeRunning` in `EvolveSessionView` now includes `fixing-types`, so the Abort button is rendered in the "Available Actions" header for all three active-Claude states.
- The server-restart recovery path (when no in-memory abort controller exists) appends an extra note for `fixing-types` sessions explaining that auto-accept was cancelled and the user can accept or reject manually.

## Why

A session stuck in `fixing-types` (e.g. because the Claude Code process died mid-run) had no escape hatch — the UI showed a spinner with "will auto-accept when complete" and no way to break out. The Abort button was only wired to `starting`/`running-claude` states. This change gives users a way to recover borked type-fixing sessions without needing to manually poke the database.
