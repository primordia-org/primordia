# Evolve Pipeline — Architecture Reference

This file covers the evolve subsystem: the API routes under `app/api/evolve/`, the session state machine, and the NDJSON log format used by worktrees.

---

## Evolve Request Data Flow

```
User types change request on /evolve page
  → POST /api/evolve
      → generates slug via the selected evolve model; finds unique branch name
      → creates LocalSession in memory (id, branch, worktreePath, request, createdAt, …)
      → persists EvolveSession record to SQLite (evolve_sessions table)
      → returns { sessionId }
  → browser redirects to /evolve/session/{sessionId}
  → server component reads initial state from SQLite, renders EvolveSessionView
  → git worktree add $PRIMORDIA_DIR/worktrees/{branchName} -b {branchName}
       ($PRIMORDIA_DIR is set by the installer — the repo root for fresh installs, two levels above the worktree for worktree-based installs; branches with slashes not supported)
  → records parentage in legacy git config (`branch.{branch}.parent`) and writes an empty `[primordia] fork marker` commit with `Primordia-Forked-From: <parent>@<sha>` so trailer-based parentage can survive pushes/clones
  → bun install in worktree
  → copy .primordia-auth.db + symlink .env.local into worktree
  → @anthropic-ai/claude-agent-sdk query() in worktree
      → streams SDKMessage events → formatted progressText appended in memory
      → progressText flushed to SQLite (throttled, ≤1 write/2s per session)
  → assigns ephemeral port to branch in git config (branch.{branch}.port) — idempotent, stable for branch lifetime
  → spawn: bun run dev in worktree with PORT=branch port and NEXT_BASE_PATH=/preview/{branchName}
      → on ready: previewUrl = http://{host}:{REVERSE_PROXY_PORT}/preview/{branchName} (proxy routes by branch name via git config)
  → EvolveSessionView opens SSE stream to /api/evolve/stream?sessionId=... (sessionId = branchName)
      → GET streams delta progressText + state every 500 ms from SQLite until terminal
  → Preview link shown when status becomes "ready"
  → User clicks Accept → POST /api/evolve/manage { action: "accept" }
      → pre-accept gates: (1) ancestor check — auto-merges parent if ahead; (2) clean worktree — auto-commits unstaged changes; (3) concurrent deploy guard — returns 409 if another session is already `accepting`; then runs install.sh which includes typecheck + build
      → blue/green deploy (production): bun install in worktree → session branch becomes new prod as-is (no merge commit; Gate 1 guarantees it already contains parentBranch)
          → parentBranch ref NOT advanced — old slot stays at pre-accept commit so rollback can match it by branch name
          → sibling sessions using legacy git-config parentage are reparented to the session branch; fork-marker parentage remains immutable, and marker-mode parent resolution dynamically falls back to current production when the original parent has been deployed
          → session worktree stays checked out on the session branch; no detached HEAD
          → copy prod DB from old slot into new slot (preserves auth data)
          → fix .env.local symlink in new slot to point to main repo (prevents dangling link)
          → POST /_proxy/prod/spawn to the reverse proxy (SSE stream): proxy spawns new prod server, health-checks it, sets primordia.productionBranch + productionHistory in git config, and switches traffic; proxy does NOT kill the old prod server
          → old prod server self-terminates (process.exit) after the proxy switches traffic; proxy owns the new server process
          → old slots accumulate indefinitely as registered git worktrees (enables deep rollback via /admin/rollback)
      → legacy deploy (local dev, NODE_ENV !== 'production'): git merge in production dir → bun install → worktree remove
  → User clicks Reject → POST /api/evolve/manage { action: "reject" }
      → kill dev server, git worktree remove, git branch -D
```

---

## Evolve Session State Machine

Each evolve session tracks two independent dimensions persisted to SQLite:

- **`LocalSessionStatus`** — the session pipeline lifecycle (what Claude / the worktree is doing)
- **`DevServerStatus`** — the state of the preview dev server for this session

**Session status reference**

| `LocalSessionStatus` | Meaning |
|---|---|
| `starting` | Session created; git worktree + `bun install` in progress |
| `running-claude` | Claude Agent SDK `query()` is streaming tool calls into the worktree |
| `fixing-types` | TypeScript or build gate failed on Accept; Claude is auto-fixing compilation errors; session page keeps Available Actions panel visible; server retries Accept when done (client tab does not need to be open) |
| `ready` | Claude Code finished (or errored); worktree is live and interactive. If an error occurred, the progress log contains an `❌ **Error**:` entry and the Claude Code section heading is styled in red. |
| `accepting` | User clicked Accept; typecheck/build/deploy pipeline is running asynchronously. No other session can enter `accepting` while this status is set — the manage route returns 409 if a concurrent deploy is attempted (prevents two deploys racing and the second overwriting the first). |
| `accepted` | Deploy complete; branch is live in production (blue/green) or merged into parent (legacy). |
| `rejected` | User clicked Reject; worktree and branch discarded without merging |

**Dev server status reference**

| `DevServerStatus` | Meaning |
|---|---|
| `none` | Dev server not yet started (session is `starting` or `running-claude`) |
| `starting` | `bun run dev` has been spawned; waiting for Next.js "Ready" signal |
| `running` | Dev server is up; `previewUrl` is set and the preview is accessible |
| `disconnected` | Server was running, then exited unexpectedly (branch still exists) |

**Key transition triggers**

| Transition | Triggered by |
|---|---|
| `[new]` → `starting` | `POST /api/evolve` |
| `starting` → `running-claude` | `startLocalEvolve()` after worktree setup, including a `VACUUM INTO` production DB snapshot copied into the worktree |
| `running-claude` → `ready` + devServer `none→starting` | `startLocalEvolve()` after `query()` completes |
| devServer `starting` → `running` | Next.js "Ready" string detected in dev server output |
| `running-claude` → `ready` (devServer `none→starting`) | `POST /api/evolve/abort` — user aborts; dev server starts with partial work |
| `ready` → `running-claude` (devServer stays `running`) | `POST /api/evolve/followup` |
| `running-claude` → `ready` (devServer stays `running`) | `runFollowupInWorktree()` on success |
| `ready` → `fixing-types` (devServer stays `running`) | `POST /api/evolve/manage` when TypeScript or build gate fails |
| `fixing-types` → `accepted` | `runFollowupInWorktree()` success + re-typecheck + re-build both pass; server merges without client |
| `fixing-types` → `ready` (with `❌` error in log) | `runFollowupInWorktree()` success but type/build errors persist after fix, or merge fails |
| `ready` → `accepting` | `POST /api/evolve/manage` (Gates 1–3 pass; async pipeline begins) |
| `accepting` → `accepted` | `runAcceptAsync()` completes successfully |
| `accepting` → `ready` (with `❌` error) | `runAcceptAsync()` fails at any step |
| `ready` → `rejected` | `POST /api/evolve/manage` { action: "reject" } |
| devServer `running` → `disconnected` | Dev server `close` event + branch still present (3 s later) |
| devServer `disconnected` → `starting` | `POST /api/evolve/kill-restart` |
| session branch behind parent → current code/data | `POST /api/evolve/upstream-sync` merges the parent/prod branch, creates a production DB snapshot via `VACUUM INTO`, then asks the running preview server to close and hot-swap its SQLite DB before reopening on the next DB access |
| any → `ready` (with `❌` error in log) | Uncaught exception inside the respective async helper |

---

## Worktree Session History (NDJSON Log)

Every evolve worktree keeps a structured event log at `.primordia-session.ndjson` (one JSON object per line). This file is the single source of truth for session state — it records the initial request, every follow-up request, all agent tool calls and text output, result status, and metrics for each run.

When an agent is invoked for a follow-up request it typically resumes its own session (`useContinue: true`) and already has full conversation history. If for any reason the agent has no native memory of prior work in the worktree (e.g. a fresh start or a harness that does not support session resumption), read `.primordia-session.ndjson` to reconstruct context:

- `initial_request` events contain the original change request text.
- `followup_request` events contain each subsequent request, in order.
- `section_start` events with `sectionType: 'agent'` identify which harness and model ran each phase.
- `result` events record whether each phase succeeded, errored, timed out, or was aborted.

The log is append-only and never truncated for the lifetime of the session.
