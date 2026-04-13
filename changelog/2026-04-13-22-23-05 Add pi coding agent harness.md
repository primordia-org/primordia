# Add pi coding agent harness

## What changed

- Installed `@mariozechner/pi-coding-agent` (v0.66.1) as a runtime dependency.
- Added a new `pi` harness option to `lib/agent-config.ts` alongside the existing `claude-code` harness, with the same Claude model choices (Sonnet 4, Opus 4, Haiku 4).
- Created `scripts/pi-worker.ts` — a new standalone worker that uses the pi SDK (`createAgentSession`, `SessionManager`, `DefaultResourceLoader`, `createCodingTools`) instead of the Claude Agent SDK `query()` call. It follows the same lifecycle contract as `claude-worker.ts`: writes a PID file, streams events to the NDJSON log, handles SIGTERM/timeout, and emits `result` + `metrics` events on completion.
- Updated `lib/evolve-sessions.ts` to select `scripts/pi-worker.ts` when the session harness is `pi`, falling back to `scripts/claude-worker.ts` for all other harnesses. The `fuHarnessId` variable was hoisted to function scope in `runFollowupInWorktree` so it can be referenced by both the event-logging block and the worker-script selection.

## Why

The pi coding agent (`@mariozechner/pi-coding-agent`) is an alternative agentic coding harness with its own session management, tool implementations, and resource loading pipeline. Supporting it as a selectable harness lets users experiment with pi as a drop-in alternative to Claude Code for evolve sessions, using the same model selection UI and the same NDJSON event format for progress display.
