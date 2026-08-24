# Core API migration status

Primordia Core is the extraction path that lets the current Next.js app become just one frontend. The target is that thread creation, live thread viewing, preview/server control, and administrative operations are exposed by frontend-neutral Core commands/API handlers so a static SPA, Expo app, CLI, or another web framework can drive Primordia without importing `app/api/**` or depending on Next.js.

This document tracks the current `/app/api` surface from that perspective. "Core replacement" currently means a reusable Core/library function or `bun run primordia ... --json` command exists that can be used without importing a Next route. It does **not** always mean the browser has already stopped calling the Next endpoint.

## Thread page migration summary

The thread detail page (`/thread/[id]`) is only partially migrated. The mutation and preview-process pieces have Core command equivalents, but the page still needs Core replacements for read/query endpoints and streamed/static assets before it can be implemented as a static SPA or Expo screen.

### Already covered by Core commands or shared Core modules

| Current Next endpoint / data source | Thread page use | Core replacement status | Notes |
|---|---|---|---|
| `POST /api/thread` | Create a new thread from the thread form | ✅ `bun run primordia thread create --json` and `lib/threads.createThread()` | Core command covers CLI text requests. Browser-style multipart upload semantics still need an HTTP/Core adapter if non-Next frontends upload attachments directly. |
| `POST /api/thread/followup` | Submit follow-up requests | ✅ `bun run primordia thread followup --json` and `lib/threads.followupThread()` | Same attachment caveat as create. The shared library already accepts attachment paths. |
| `POST /api/thread/manage` | Accept or reject a ready thread | ✅ `bun run primordia thread accept --json`, `bun run primordia thread reject --json`, and `lib/threads.manageThread()` | Accept still needs credentials via `PRIMORDIA_CLI_KEY`/resolved AES key outside the Next session model. |
| `POST /api/thread/upstream-sync` | Apply parent/prod updates to a thread | ✅ `bun run primordia thread update --json` and `lib/threads.updateThread()` | Covers the merge/update operation. |
| `GET /api/server/logs` | Stream preview server logs in the thread page | ✅ `bun run primordia server logs --follow` | Core command exists; a frontend-neutral streaming transport still needs to wrap it for browser/Expo clients. |
| `POST /api/server/kill-restart` | Restart preview server controls | ✅ `bun run primordia server restart --json` | The CLI resolves the current thread from cwd; a Core HTTP API should accept an explicit thread id. |
| Direct preview server lifecycle used by accept/publish | Publish or switch production | ✅ `bun run primordia server start|publish|copydb --json` and process-manager functions | Not all of this is called by the thread page, but the process-management boundary has moved out of Next. |

### Still needed for a complete thread-page migration

| Current Next endpoint / data source | Thread page use | Needed Core API shape | Why it matters |
|---|---|---|---|
| `GET /api/thread/stream?threadId=&offset=` | Live session events, status, preview URL, credential-rotation notifications | `core thread stream <threadId> --offset <n>` or an HTTP/SSE/WebSocket Core endpoint | This is the main live data channel. Static SPA and Expo frontends need a transport that does not rely on a Next route. |
| `GET /api/thread/diff-summary?threadId=` | "Files changed" summary and manual refresh | `core thread diff-summary <threadId> --json` | User specifically called this out. The implementation is still duplicated in `app/thread/[id]/page.tsx` and the Next route. Move git diff-summary logic into `lib/*` first. |
| `GET /api/thread/diff?threadId=&file=...` | Lazy expanded unified diff per file | `core thread diff <threadId> --file <path>` with text output, ETag/hash metadata for HTTP wrappers | User specifically called this out. Needs pathspec validation and rename handling in a shared module. |
| `GET /api/thread/attachment/[threadId]?file=` | Render/download uploaded attachments and final-message images | `core thread attachment <threadId> <filename>` or a Core static-file response helper | User specifically called this out. Needs MIME/content-disposition logic outside Next and a frontend-neutral URL/signing strategy. |
| `POST /api/thread/abort` | Stop a running agent and return to ready | `core thread abort <threadId> --json` | There is a shared `abortAgentRun()` helper, but no Core command/API wrapper yet. |
| `POST /api/thread/reset-stuck` | Recover stuck `accepting`/`fixing-types` threads | `core thread reset-stuck <threadId> --json` | Logic is still route-local and should move to `lib/threads` or a thread-maintenance module. |
| `GET /api/thread/models` | Model picker data | `core models list --json` or static model registry export | The data comes from `lib/agent-config`, but there is no Core command/API contract for non-Next clients. |
| `GET /api/thread/presets` | Thread form preset availability | `core presets list --user <id> --json` or user-authenticated Core endpoint | Depends on current user, encrypted credential availability, and preferences. There are shared helpers, but the route owns the response shape. |
| `GET /api/thread/sessions` | Notification bell active-thread list | `core thread list --active --json` | Not central to the detail page, but needed by current shell/navigation around the thread UI. |
| `POST /api/thread/from-branch` | Create a thread wrapper for an existing branch from `/threads` | `core thread from-branch <branch> --json` | Required for the branch tree flow that leads into the thread page. Logic is currently route-local. |
| Server component data in `app/thread/[id]/page.tsx` | Initial session record, initial NDJSON events, parent branch, upstream commit count, initial diff summary, initial server log tail, permissions, user prefs | `core thread show <threadId> --json` plus `core preferences get --json` and explicit auth/permission data | A static frontend cannot run these filesystem/git reads in a React Server Component. This should become the primary bootstrap payload for the thread detail screen. |

## `/app/api` endpoint inventory

### Replaced or mostly replaced by Core boundaries

These endpoints already have a Core command or shared module that performs the core operation. Some still need a thin frontend-neutral HTTP/SSE adapter before the Next route can disappear.

| Endpoint | Core replacement | Remaining gap |
|---|---|---|
| `POST /api/thread` | `primordia thread create --json`, `lib/threads.createThread()` | Browser multipart attachment upload adapter. |
| `POST /api/thread/followup` | `primordia thread followup --json`, `lib/threads.followupThread()` | Browser multipart attachment upload adapter. |
| `POST /api/thread/manage` | `primordia thread accept|reject --json`, `lib/threads.manageThread()` | Explicit user/credential transport for web clients. |
| `POST /api/thread/upstream-sync` | `primordia thread update --json`, `lib/threads.updateThread()` | Explicit thread-id Core HTTP adapter. |
| `POST /api/server/kill-restart` | `primordia server restart --json` | Explicit thread-id Core HTTP adapter. |
| `GET /api/server/logs` | `primordia server logs --follow` | Core streaming adapter. |
| Process publish/start/copy DB behavior behind install/accept | `primordia server start|publish|copydb --json` | Some call sites still assume cwd/current-thread semantics. |
| Scheduled jobs behavior | `primordia jobs run|run-one|restart|logs|schedule ...` and `lib/scheduled-jobs.ts` | Admin pages still use Next endpoints for UI actions and alerts. |
| Reverse proxy/service-supervisor operations | `primordia reverse-proxy restart|logs`, `primordia systemd service-supervisor restart` | Admin pages still use Next endpoints or journal routes. |
| Thread preferences | `primordia preferences get|set --json` and `lib/user-prefs.ts` | Thread form still fetches presets/models through Next routes. |

### Thread and preview endpoints that still need Core replacements

| Endpoint | Status | Suggested Core replacement |
|---|---|---|
| `GET /api/thread` | ⚠️ Route-local status wrapper over filesystem session lookup | Fold into `core thread show <threadId> --json`. |
| `GET /api/thread/stream` | ❌ Next-only SSE loop | `core thread stream <threadId> --offset <n>` or Core SSE/WebSocket endpoint. |
| `POST /api/thread/abort` | ⚠️ Uses shared abort helper, route owns validation/status event fallback | `core thread abort <threadId> --json`. |
| `POST /api/thread/reset-stuck` | ❌ Route-local recovery workflow | `core thread reset-stuck <threadId> --json`. |
| `GET /api/thread/diff-summary` | ❌ Route-local git diff summary | `core thread diff-summary <threadId> --json` backed by shared `lib/thread-diff.ts`. |
| `GET /api/thread/diff` | ❌ Route-local raw diff generation | `core thread diff <threadId> --file <path>`. |
| `GET /api/thread/attachment/[threadId]` | ❌ Route-local file serving | `core thread attachment` response helper or static asset service. |
| `GET /api/thread/models` | ⚠️ Shared data, no Core API contract | `core models list --json`. |
| `GET /api/thread/presets` | ⚠️ Shared helpers, route owns authenticated shape | `core presets list --user <id> --json`. |
| `GET /api/thread/sessions` | ❌ Route-local active-session list | `core thread list --active --json`. |
| `POST /api/thread/from-branch` | ❌ Route-local branch/worktree attach flow | `core thread from-branch <branch> --json`. |
| `POST /api/server/hotswap-db` | ❌ Internal loopback Next endpoint | Replace with process-manager/Core DB hotswap command or remove by doing copy+restart entirely through Core. |

### Non-thread `/app/api` endpoints still outside Core

These are not blockers for the thread detail page, but they are blockers for eliminating Next.js as an application dependency.

| Area | Endpoints | Migration note |
|---|---|---|
| Authentication/session | `/api/auth/**` | Needs frontend-neutral auth adapters. Passkey and cross-device routes are deeply tied to HTTP cookies and browser WebAuthn ceremonies. |
| Secrets, API keys, credential encryption, OAuth | `/api/secrets/**`, `/api/settings/api-keys`, `/api/settings/presets`, `/api/credential-encryption/public-key`, `/api/oauth/chatgpt-subscription`, `/api/claude-auth/**` | Core needs a stable authenticated secrets/credentials API before web, CLI, SPA, and Expo clients can share account settings. |
| Admin operations | `/api/admin/**` | Many operations already have library/CLI pieces, but admin-specific response shapes and auth checks remain Next routes. |
| Instance graph | `/api/instance/**`, `/.well-known/primordia.json` route equivalents | Move manifest/config/register handlers behind Core HTTP handlers so any frontend can expose them. |
| Web push | `/api/web-push/**` | Browser push is web-specific but should be a Core capability with frontend adapters. Expo will need a separate push adapter. |
| Changelog/docs/demo utilities | `/api/changelog`, `/api/markdown-stream`, `/api/openapi` | Not thread-critical. Changelog can become static/Core file reads; markdown-stream is test-only; OpenAPI generation changes once Core owns the API. |
| Git HTTP | `/api/git/[...path]` | Needs a non-Next HTTP server route if Primordia continues serving read-only clones. |
| User events | `/api/events` | Move event ingestion/query to Core if analytics should work across frontends. |
| Retired endpoints | `/api/prune-branches`, `/api/rollback` | Already return `410 Gone`; no Core replacement needed unless compatibility is required. |

## Recommended next steps

1. Extract `lib/thread-diff.ts` with `getThreadDiffSummary(threadId)` and `getThreadFileDiff(threadId, file, options)`; update both `app/thread/[id]/page.tsx` and the two diff routes to use it.
2. Extract `lib/thread-attachments.ts` with safe filename validation, MIME detection, and `getThreadAttachment(threadId, filename)` metadata/data helpers; update the Next route and markdown image URL contract.
3. Add Core commands/API contracts for `thread show`, `thread stream`, `thread diff-summary`, `thread diff`, `thread attachment`, `thread abort`, and `thread reset-stuck`.
4. Change the Next thread page to consume those Core contracts instead of direct filesystem/git reads. That makes the Next app a compatibility frontend and gives static SPA/Expo clients the same data model.
5. After the thread page is fully Core-backed, repeat the same inventory for auth/settings/admin so the whole application can run without Next.js.
