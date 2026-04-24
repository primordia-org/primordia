# Make component and variable names agent-agnostic

## What changed

Renamed programmatic identifiers that referenced "Claude" in their names to use agent-agnostic equivalents, so the codebase is not tied to a specific AI provider in its naming:

### `lib/evolve-sessions.ts`
- `spawnClaudeWorker` → `spawnAgentWorker`
- `abortClaudeRun` → `abortAgentRun` (exported; updated all callers)
- `resolveConflictsWithClaude` → `resolveConflictsWithAgent` (exported; updated all callers)
- Updated related comments to match the new names

### `app/evolve/session/[id]/EvolveSessionView.tsx`
- `splitClaudeEventsForDisplay` → `splitAgentEventsForDisplay`
- `RunningClaudeSection` → `RunningAgentSection`
- `DoneClaudeSection` → `DoneAgentSection`
- `claudeEvents` (local variable) → `agentEvents`
- `isClaudeRunning` (local variable) → `isAgentRunning`
- UI label "Waiting for Claude to finish…" → "Waiting for agent to finish…"

### `app/api/evolve/abort/route.ts`
- Updated import and call site: `abortClaudeRun` → `abortAgentRun`

### `app/api/evolve/upstream-sync/route.ts`
- Updated import and call site: `resolveConflictsWithClaude` → `resolveConflictsWithAgent`

### `app/api/evolve/manage/route.ts`
- Updated import and call site: `resolveConflictsWithClaude` → `resolveConflictsWithAgent`

## Why

The codebase already uses a harness abstraction (`agent-config.ts`) to support multiple AI agents (Claude Code, pi, etc.). Having identifiers like `DoneClaudeSection`, `abortClaudeRun`, and `isClaudeRunning` hardcoded Claude into the naming layer even though the logic is fully harness-agnostic. This change aligns identifier names with the multi-agent architecture already in place.
