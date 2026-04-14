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

## Follow-up fix: conflict resolution also uses Pi harness + gateway

The upstream-sync merge conflict resolution (`resolveConflictsWithClaude`) was calling `@anthropic-ai/claude-agent-sdk`'s `query()` directly inside the main server process. Unlike the worker scripts, the server process does not have `ANTHROPIC_BASE_URL` or `ANTHROPIC_API_KEY` set, which caused a "Not logged in · Please run /login" error when a merge conflict required automatic AI resolution.

### Additional files changed

- **`scripts/conflict-worker.ts`** *(new)*: Standalone worker that runs the Pi coding agent for conflict resolution. Always uses the exe.dev LLM gateway (no API key required). Accepts a config file with `{ prompt, worktreePath, repoRoot, resultFile }` and writes `{ success: boolean, log: string }` to `resultFile` on exit.

- **`lib/evolve-sessions.ts`**:
  - Removed the `import { query }` from `@anthropic-ai/claude-agent-sdk` (no longer called directly).
  - `resolveConflictsWithClaude` now accepts an optional `repoRoot` parameter and spawns `scripts/conflict-worker.ts` as a subprocess instead of calling `query()` inline. Reads the JSON result file the worker writes. After the worker exits, still verifies that `MERGE_HEAD` no longer exists (merge was committed).

- **`app/api/evolve/upstream-sync/route.ts`**: Passes `repoRoot` to `resolveConflictsWithClaude`.

### Why

All Claude/Pi invocations in the evolve pipeline must go through a worker subprocess so the LLM gateway environment variables are set correctly. Running `query()` inline in the Next.js server process bypassed this entirely and fell back to the Claude Code CLI's own auth mechanism, which requires an interactive `/login` that is not available in headless server context.
