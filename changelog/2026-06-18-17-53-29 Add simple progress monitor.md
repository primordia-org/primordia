# Add simple progress monitor

Implemented the dead simple Evolve progress monitor protocol so agent runs can report meaningful stages with shell commands instead of Pi-only EDB todo tools.

## What changed

- Added `bun run progress` with `plan insert`, `plan replace`, and `step done|failed` commands that append `progress_*` events to the current agent run in the session NDJSON log.
- Added shared reducer/validation logic for progress state, including weighted progress, single-active-step enforcement, future step insertion/replacement, and failed-step handling.
- Updated the Evolve session UI to render progress panels with weighted bars, step lists, grouped details, and legacy todo fallback support.
- Ensured completed agent sections still render their progress panel even when the run ends successfully, errors, times out, or is aborted before any tool call, while keeping the final summary visible outside the progress accordion.
- Injected the progress monitor instructions into Claude Code, Pi, and Codex workers.
- Removed the headless Pi worker dependency on the `@agnishc/edb-todo` extension and its task tools for new runs.
- Removed the project-level Pi package declaration for `@agnishc/edb-todo` so preview sessions no longer try to install the old extension before starting.
- Added red/green unit coverage for the progress reducer and validation behavior.
- Scoped the progress CLI to the latest agent section so follow-up requests start fresh with `Make a plan` even after an earlier run completed all steps.

## Why

The progress monitor is now Primordia-owned, harness-neutral, and usable through ordinary shell access. This keeps progress tracking lightweight for agents while giving users a consistent session progress panel across Pi, Claude Code, and Codex runs.
