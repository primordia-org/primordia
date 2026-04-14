# Remove ANTHROPIC_API_KEY and use LLM gateway everywhere

## What changed

- **`scripts/claude-worker.ts`**: Now unconditionally points `@anthropic-ai/claude-agent-sdk` at the exe.dev LLM gateway by setting `process.env.ANTHROPIC_BASE_URL` and `process.env.ANTHROPIC_API_KEY = 'gateway'` before the SDK is invoked. The claude-agent-sdk (and the Claude Code subprocess it spawns) inherits these env vars, so all evolve requests route through the gateway.

- **`lib/llm-client.ts`**: Removed the gateway probe + `ANTHROPIC_API_KEY` fallback. `getLlmClient()` is now a plain synchronous function that always returns a client pointed at the gateway. The `isGatewayAvailable()` export is removed.

- **`app/api/chat/route.ts`**, **`app/api/evolve/route.ts`**, **`app/api/evolve/from-branch/route.ts`**: Updated call sites from `await getLlmClient()` to `getLlmClient()` (now sync).

- **`app/api/check-keys/route.ts`**: Removed the `ANTHROPIC_API_KEY` missing-key check. The endpoint now always returns an empty `missing` array since the gateway handles all auth.

- **`.env.example`**: Removed the `ANTHROPIC_API_KEY` entry. Only `REVERSE_PROXY_PORT` remains required.

- **`README.md`**, **`CLAUDE.md`**: Updated all documentation to remove mentions of `ANTHROPIC_API_KEY` as a requirement. Both the chat interface and the evolve pipeline (Claude Code and pi worker) now use the exe.dev LLM gateway exclusively.

- **`app/api/markdown-stream/route.ts`**: Removed `ANTHROPIC_API_KEY` from the sample environment-variable table in the streaming markdown test content.

## Why

The pi worker (`scripts/pi-worker.ts`) was already using the LLM gateway exclusively. This change brings `scripts/claude-worker.ts` (the `@anthropic-ai/claude-agent-sdk`-based harness) and the chat client (`lib/llm-client.ts`) into alignment — all LLM traffic now routes through the exe.dev gateway with no API key required. This removes a required secret from the setup checklist and eliminates the probe-and-fallback complexity that was masking whether the gateway codepath was actually being exercised.

---

## Follow-up fix: conflict resolution uses Pi harness + gateway; Accept blocked until branch is up-to-date

Two related fixes to the upstream-sync / accept pipeline:

### 1 — Accept button disabled until branch is up-to-date

The Accept Changes button in the session view is now disabled when the parent branch has unmerged commits (`remainingUpstream > 0`). The button label changes to "Apply Updates First" and shows a tooltip with the count. This makes the existing backend Gate 1 (ancestor check) visible in the UI before the user clicks, rather than showing an error after the fact.

- **`components/EvolveSessionView.tsx`**: Accept button disabled + relabelled when `remainingUpstream > 0`.

### 2 — Conflict resolution runs as a proper agent step in the session log

Previously `resolveConflictsWithClaude` called `@anthropic-ai/claude-agent-sdk`'s `query()` directly inside the Next.js server process, which has no `ANTHROPIC_BASE_URL`/`ANTHROPIC_API_KEY` set. This caused "Not logged in · Please run /login". The fix uses the existing `spawnClaudeWorker` + `pi-worker.ts` infrastructure so conflict resolution goes through the LLM gateway and its output appears in the session log as a `conflict_resolution` section.

- **`lib/session-events.ts`**: Added `conflict_resolution` as a valid `sectionType`. `inferStatusFromEvents` treats it the same as `running-claude` while the worker is active.

- **`lib/evolve-sessions.ts`**:
  - Removed the `import { query }` from `@anthropic-ai/claude-agent-sdk` (no longer called directly in the server process).
  - `resolveConflictsWithClaude` now takes a `sessionContext` (id, harness, model, userId) parameter. It writes a `section_start: conflict_resolution` event to the session NDJSON, spawns the appropriate worker script (pi-worker or claude-worker) via `spawnClaudeWorker`, and reads the result from the NDJSON after the worker exits.

- **`app/api/evolve/upstream-sync/route.ts`**: Passes session context to `resolveConflictsWithClaude`.

- **`app/api/evolve/manage/route.ts`**: Removed `resolveConflictsWithClaude` calls from the accept path. Since Gate 1 now requires the branch to be up-to-date (parent is ancestor of HEAD), a merge during accept is always a fast-forward and can never produce conflicts. Both `runAcceptAsync` and `retryAcceptAfterFix` now return an explicit error if a conflict somehow occurs, telling the user to use Apply Updates first.

- **`components/EvolveSessionView.tsx`**: Added `conflict_resolution` to the `SectionGroup` type and renders it using the existing `RunningClaudeSection` / `DoneClaudeSection` components.

- **`scripts/conflict-worker.ts`**: Deleted — superseded by the `spawnClaudeWorker` + pi-worker approach.

### Why

All Claude/Pi invocations in the evolve pipeline must go through a worker subprocess so the LLM gateway environment variables are set correctly. Running `query()` inline in the Next.js server process bypassed this entirely and fell back to the Claude Code CLI's own auth mechanism, which requires an interactive `/login` that is not available in headless server context. Making conflict resolution a proper session log section also means users can see exactly what the agent did to resolve conflicts, with the same UI they see for normal agent runs.
