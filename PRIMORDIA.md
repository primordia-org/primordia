# PRIMORDIA.md

> **This file is the living brain of Primordia.**
> Every time Claude Code runs — whether triggered by the evolve pipeline or manually — it should:
> 1. **Read this file first** to understand the current state of the app.
> 2. **Update this file last** — keep it up to date and accurate.
>
> This file is the source of truth for architecture and features.

---

## What Is Primordia?

Primordia is a self-modifying web application. Users interact with an AI chat interface. To propose a change to the app, they open the hamburger (☰) menu in the header and choose "Propose a change" to navigate to the `/evolve` page — a dedicated "submit a request" form. Requests are automatically built as local git worktree previews, powered by the Claude Agent SDK. Users then accept or reject each preview.

The core idea: **the app becomes whatever its users need it to be**, with no coding or git knowledge required from users.

---

## Current Architecture

### Tech Stack
| Layer | Technology | Why |
|---|---|---|
| Frontend framework | Next.js 16 (App Router) | AI models write Next.js well |
| Styling | Tailwind CSS | AI models write Tailwind well; no CSS files to manage |
| Language | TypeScript | Catches mistakes; Claude Code understands it well |
| AI API | Anthropic SDK (`@anthropic-ai/sdk`) | Streaming chat via `claude-sonnet-4-6`; prefers exe.dev LLM gateway, falls back to `ANTHROPIC_API_KEY` |
| Hosting | exe.dev | Production builds via `bun run build && bun run start`; single systemd service (`primordia-proxy`) manages both proxy and production app; blue/green slot swap on accept |
| AI code gen | `@anthropic-ai/claude-agent-sdk` | `query()` runs Claude Code in git worktrees for evolve requests |
| Database | bun:sqlite | Local SQLite for passkey auth **and evolve session persistence**; same adapter on exe.dev and local dev |

### File Map

```
primordia/
├── PRIMORDIA.md                   ← You are here. Read me first, update me last.
├── README.md                      ← Public-facing project readme
├── LICENSE
├── .env.example                   ← Copy to .env.local, fill in secrets
├── .gitignore
├── next.config.ts                 ← Minimal Next.js config
├── tailwind.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── tsconfig.json
├── package.json
│
├── changelog/                     ← One .md file per change: YYYY-MM-DD-HH-MM-SS Description.md
│   └── *.md                       ← Filename = short description; body = full what+why detail
│
├── scripts/
│   ├── deploy-to-exe-dev.sh      ← `bun run deploy-to-exe.dev <server>`: SSH deploy to <server>.exe.xyz
│   ├── install-service.sh        ← Installs/re-installs the proxy systemd service; copies reverse-proxy.ts to ~/primordia-proxy.ts; initialises primordia.productionBranch in git config on first install
│   ├── reverse-proxy.ts          ← HTTP reverse proxy for zero-downtime blue/green AND preview servers; listens on REVERSE_PROXY_PORT; reads production branch from git config (primordia.productionBranch), then looks up branch.{name}.port; discovers main repo from any worktree in PRIMORDIA_WORKTREES_DIR; on startup spawns the production Next.js server if not already running and tracks the process; captures prod server stdout/stderr in a 50 KB ring buffer; exposes POST /_proxy/prod/spawn (SSE, body: { branch }) — looks up port and worktree path from git config/worktree list, then spawns, health-checks, updates git config, and SIGTERMs old server; exposes GET /_proxy/prod/logs (SSE) — streams prod server log buffer + live output; watches .git/config for instant cutover; routes /preview/{sessionId} paths to session preview servers; installed to ~/primordia-proxy.ts by install-service.sh
│   ├── install-service.sh        ← First-time install of the proxy systemd service; copies reverse-proxy.ts to ~/primordia-proxy.ts; initialises primordia.productionBranch in git config; enables and starts the service
│   ├── update-service.sh         ← Run automatically on every blue-green prod deploy; updates ~/primordia-proxy.ts and the systemd symlink only when they changed; runs daemon-reload only if the service unit changed; runs systemctl restart primordia-proxy only if the proxy script changed
│   ├── reverse-proxy.ts          ← HTTP reverse proxy for zero-downtime blue/green AND preview servers; listens on REVERSE_PROXY_PORT; reads production branch from git config (primordia.productionBranch), then looks up branch.{name}.port; discovers main repo from any worktree in PRIMORDIA_WORKTREES_DIR; on startup spawns the production Next.js server if not already running; captures prod server stdout/stderr in a 50 KB ring buffer; exposes GET /_proxy/prod/logs (SSE) — streams prod server log buffer + live output; watches .git/config for instant cutover; routes /preview/{sessionId} paths to session preview servers; installed to ~/primordia-proxy.ts by install-service.sh
│   ├── assign-branch-ports.sh    ← Idempotent migration script: assigns ephemeral ports to all local branches in git config (branch.{name}.port); main gets 3001, others get 3002+
│   ├── rollback.ts               ← Standalone CLI rollback script: updates primordia.productionBranch to the previous slot (second entry in primordia.productionHistory) and restarts primordia-proxy; use when the server itself is broken and /api/rollback is unreachable
│   └── primordia-proxy.service   ← systemd service unit for the reverse proxy; WorkingDirectory=/home/exedev/primordia; is the sole long-running service — responsible for starting the production Next.js server on boot and routing all traffic
│
├── public/
│   (no generated files)
│
├── lib/
│   ├── system-prompt.ts           ← Builds chat system prompt at runtime: reads PRIMORDIA.md + last 30 changelog filenames on each request
│   ├── auth.ts                    ← Session helpers: createSession, getSessionUser, isAdmin (admin role check), hasEvolvePermission (admin or can_evolve role)
│   ├── base-path.ts               ← basePath constant + withBasePath() helper; used by all client-side fetch() calls to prefix API routes when NEXT_BASE_PATH is set
│   ├── hooks.ts                   ← Shared React hooks: useSessionUser (fetches session on mount, provides logout)
│   ├── evolve-sessions.ts         ← Shared session state + business logic for local evolve; persists to SQLite
│   ├── page-title.ts              ← Utility: buildPageTitle() — formats <title> with port/branch suffix in development mode; clean title in production
│   └── db/
│       ├── index.ts               ← Factory: getDb() → SQLite (always)
│       ├── types.ts               ← Shared DB types: User, Passkey, Challenge, Session, CrossDeviceToken, EvolveSession, Role; DbAdapter includes role methods
│       └── sqlite.ts              ← bun:sqlite adapter (includes evolve_sessions, roles, user_roles tables; seeds built-in roles on boot)
│
├── app/                           ← Next.js App Router
│   ├── layout.tsx                 ← Root layout (font, metadata, body styling)
│   ├── page.tsx                   ← Landing page — marketing/feature overview; links to /chat and /evolve
│   ├── globals.css                ← Tailwind base imports only
│   ├── branches/
│   │   └── page.tsx               ← Server component: git branch tree; publicly viewable; admin-only actions (prune, diagnostics) conditionally hidden
│   ├── changelog/
│   │   └── page.tsx               ← Server component: reads changelog/ filenames at runtime; lazy-loads body via /api/changelog
│   ├── chat/
│   │   └── page.tsx               ← Server component: chat interface; redirects to /login if unauthenticated
│   ├── admin/
│   │   ├── page.tsx               ← Admin panel: owner-only; grant/revoke evolve access per user; tab subnav (Manage Users / Server Logs / Proxy Logs / Rollback)
│   │   ├── logs/
│   │   │   └── page.tsx           ← Server logs: streams primordia systemd journal via SSE; admin only
│   │   ├── proxy-logs/
│   │   │   └── page.tsx           ← Proxy logs: streams primordia-proxy systemd journal via SSE; admin only
│   │   └── rollback/
│   │       └── page.tsx           ← Deep rollback: lists previous prod slots from primordia.productionHistory; admin only
│   ├── oops/
│   │   └── page.tsx               ← Owner-only mobile shell: run occasional system commands without SSH
│   ├── evolve/
│   │   ├── page.tsx               ← Dedicated "propose a change" page; renders <EvolveForm>; requires evolve permission
│   │   └── session/
│   │       └── [id]/
│   │           └── page.tsx       ← Session-tracking page; publicly viewable; passes canEvolve to hide actions for non-evolvers
│   ├── login/
│   │   ├── page.tsx               ← Passkey login/register page + QR cross-device tab (server shell)
│   │   ├── LoginClient.tsx        ← Client component: passkey register/login UI + QR polling
│   │   └── approve/
│   │       └── page.tsx           ← Approval page: authenticated device approves a QR sign-in
│   └── api/
│       ├── changelog/
│       │   └── route.ts           ← GET ?filename=...: returns raw markdown body of one changelog file (lazy-load)
│       ├── chat/
│       │   └── route.ts           ← Streams Claude responses via SSE
│       ├── check-keys/
│       │   └── route.ts           ← Returns list of missing required env vars (called on page load)
│       ├── git-sync/
│       │   └── route.ts           ← POST pull + push the current branch (used by GitSyncDialog)
│       ├── rollback/
│       │   └── route.ts           ← GET hasPrevious check; POST swap current↔previous + systemd restart (admin only)
│       ├── admin/
│       │   ├── permissions/
│       │   │   └── route.ts       ← POST grant/revoke grantable roles (can_evolve); admin only
│       │   ├── logs/
│       │   │   └── route.ts       ← GET SSE stream of production server logs; proxies /_proxy/prod/logs when REVERSE_PROXY_PORT is set, else falls back to journalctl -u primordia; admin only
│       │   ├── proxy-logs/
│       │   │   └── route.ts       ← GET SSE stream of `journalctl -u primordia-proxy -f -n 100`; admin only
│       │   └── rollback/
│       │       └── route.ts       ← GET list previous prod slots from primordia.productionHistory; POST apply deep rollback to any slot; admin only
│       ├── prune-branches/
│       │   └── route.ts           ← POST delete all local branches merged into main; streams SSE progress
│       ├── auth/
│       │   ├── session/
│       │   │   └── route.ts       ← GET current session user
│       │   ├── logout/
│       │   │   └── route.ts       ← POST clear session
│       │   ├── exe-dev/
│       │   │   └── route.ts       ← GET exe.dev SSO login: reads injected headers, creates/finds user + session
│       │   ├── passkey/
│       │   │   ├── register/
│       │   │   │   ├── start/route.ts  ← Generate WebAuthn registration options
│       │   │   │   └── finish/route.ts ← Verify registration, create user+session
│       │   │   └── login/
│       │   │       ├── start/route.ts  ← Generate WebAuthn authentication options
│       │   │       └── finish/route.ts ← Verify authentication, create session
│       │   └── cross-device/
│       │       ├── start/route.ts      ← POST create a cross-device token; returns tokenId
│       │       ├── poll/route.ts       ← GET poll token status; sets session cookie on approval
│       │       ├── approve/route.ts    ← POST approve a token (requires auth on approver device)
│       │       └── qr/route.ts         ← GET SVG QR code encoding the approval URL for a tokenId
│       ├── git/
│       │   └── [...path]/
│       │       └── route.ts       ← GET/POST git http-backend proxy (read-only clone/fetch); push (receive-pack) blocked with 403
│       ├── oops/
│       │   └── route.ts           ← POST run shell command (streams SSE stdout+stderr); admin only
│       └── evolve/
│               ├── route.ts       ← POST start session (requires can_evolve permission), GET status (legacy poll)
│               ├── stream/
│               │   └── route.ts   ← GET SSE stream of live session progress
│               ├── manage/
│               │   └── route.ts   ← POST accept/reject a local session
│               ├── followup/
│               │   └── route.ts   ← POST submit a follow-up request on an existing ready session
│               ├── abort/
│               │   └── route.ts   ← POST abort the running Claude Code instance; transitions session to ready
│               ├── kill-restart/
│               │   └── route.ts   ← POST kill dev server process + restart it in the worktree
│               ├── upstream-sync/
│               │   └── route.ts   ← POST merge or rebase parent branch into session worktree
│               └── from-branch/
│                   └── route.ts   ← POST start a session on an existing local branch (external contributor workflow)
│               └── upstream-sync/
│                   └── route.ts   ← POST merge parent branch into session worktree ("Apply Updates")
│
├── components/
│   ├── AcceptRejectBar.tsx        ← Accept/reject bar for local preview worktrees
│   ├── AdminPermissionsClient.tsx ← Client component: grant/revoke 'can_evolve' role per user (used by /admin)
│   ├── AdminRollbackClient.tsx    ← Client component: deep rollback UI; lists PROD reflog targets with roll-back buttons (used by /admin/rollback)
│   ├── AdminSubNav.tsx            ← Tab subnav for admin pages: "Manage Users" (/admin), "Server Logs" (/admin/logs), "Proxy Logs" (/admin/proxy-logs), "Rollback" (/admin/rollback)
│   ├── ForbiddenPage.tsx          ← Server component: 403 access-denied page with page description, required/met/unmet conditions, and how-to-fix
│   ├── ChatInterface.tsx          ← Main chat UI (chat only); hamburger menu "Propose a change" opens FloatingEvolveDialog
│   ├── ChangelogEntryDetails.tsx  ← Client component: single changelog <details> widget; lazy-loads body from /api/changelog on first open
│   ├── EvolveForm.tsx             ← "Submit a request" form; POSTs then redirects to /evolve/session/{id}; used by /evolve page
│   ├── FloatingEvolveDialog.tsx   ← Draggable, dockable floating popup with the evolve form; opened from hamburger "Propose a change" on any page
│   ├── EvolveSessionView.tsx      ← Client component for session tracking page; streams live progress via SSE
│   ├── GitSyncDialog.tsx          ← Modal: git pull + push via /api/git-sync (wraps StreamingDialog)
│   ├── HamburgerMenu.tsx          ← Reusable hamburger button + dropdown; used by ChatInterface, EvolveForm, EvolveSessionView, PageNavBar
│   ├── LandingNav.tsx             ← Landing page navbar with mobile hamburger collapse
│   ├── OopsShell.tsx              ← Client component: mobile-friendly shell for /oops; streams command output via SSE
│   ├── ServerLogsClient.tsx       ← Client component: live tail of primordia systemd journal via SSE (/admin/logs)
│   ├── NavHeader.tsx              ← Shared nav header (title, branch name, nav links)
│   ├── PageNavBar.tsx             ← Shared nav header + hamburger for /changelog and /branches pages
│   ├── CreateSessionFromBranchButton.tsx ← Client component: "+ session" button on Branches page; inline form to start a session on an existing branch
│   ├── PruneBranchesButton.tsx    ← Client-side trigger button for PruneBranchesDialog
│   ├── PruneBranchesDialog.tsx    ← Thin wrapper around StreamingDialog for delete-merged-branches action
│   ├── SimpleMarkdown.tsx         ← Minimal markdown renderer (bold, links, inline code, code blocks)
│   └── StreamingDialog.tsx        ← Generic modal for SSE-streaming operations (git-sync, prune-branches, etc.)
```

### Data Flow

#### Normal Chat
```
User types message
  → POST /api/chat
  → Anthropic API (claude-sonnet-4-6, streaming)
  → SSE stream back to browser
  → Message appended to chat
```

#### Evolve Request
```
User types change request on /evolve page
  → POST /api/evolve
      → generates slug via Claude Haiku; finds unique branch name
      → creates LocalSession in memory (id, branch, worktreePath, request, createdAt, …)
      → persists EvolveSession record to SQLite (evolve_sessions table)
      → returns { sessionId }
  → browser redirects to /evolve/session/{sessionId}
  → server component reads initial state from SQLite, renders EvolveSessionView
  → git worktree add ../{slug} -b {slug}
  → git worktree add $PRIMORDIA_DIR/{slug} -b {slug}
       (flat layout: $PRIMORDIA_DIR/main = main repo; $PRIMORDIA_DIR/{slug} = worktrees)
  → bun install in worktree
  → copy .primordia-auth.db + symlink .env.local into worktree
  → @anthropic-ai/claude-agent-sdk query() in worktree
      → streams SDKMessage events → formatted progressText appended in memory
      → progressText flushed to SQLite (throttled, ≤1 write/2s per session)
  → assigns ephemeral port to branch in git config (branch.{branch}.port) — idempotent, stable for branch lifetime
  → spawn: bun run dev in worktree with PORT=branch port and NEXT_BASE_PATH=/preview/{sessionId} (when REVERSE_PROXY_PORT is set)
      → on ready: previewUrl = http://{host}:{REVERSE_PROXY_PORT}/preview/{sessionId} (proxy routes by session ID via git config)
      → fallback when no proxy: NEXT_BASE_PATH unset; previewUrl = http://{host}:{port} (direct)
  → EvolveSessionView opens SSE stream to /api/evolve/stream?sessionId=...
      → GET streams delta progressText + state every 500 ms from SQLite until terminal
  → Preview link shown when status becomes "ready"
  → User clicks Accept → POST /api/evolve/manage { action: "accept" }
      → pre-accept gates: ancestor check, clean worktree, bun run typecheck, bun run build (all in session worktree)
      → blue/green deploy (production): bun install in worktree → session branch becomes new prod as-is (no merge commit; Gate 1 guarantees it already contains parentBranch)
          → parentBranch ref NOT advanced — old slot stays at pre-accept commit so rollback can match it by branch name
          → sibling sessions whose git config parent = parentBranch are reparented to session branch (so "Apply Updates" picks up new prod)
          → session worktree stays checked out on the session branch; no detached HEAD
          → copy prod DB from old slot into new slot (preserves auth data)
          → fix .env.local symlink in new slot to point to main repo (prevents dangling link)
          → POST /_proxy/prod/spawn to the reverse proxy (SSE stream): proxy spawns new prod server, health-checks it, sets primordia.productionBranch + productionHistory in git config, SIGTERMs old prod server; proxy owns the new server process
          → old slots accumulate indefinitely as registered git worktrees (enables deep rollback via /admin/rollback)
      → legacy deploy (local dev, no systemd): git merge in production dir → bun install → worktree remove
  → User clicks Reject → POST /api/evolve/manage { action: "reject" }
      → kill dev server, git worktree remove, git branch -D
```

#### Evolve Session State Machine

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
| `starting` → `running-claude` | `startLocalEvolve()` after worktree setup |
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
| any → `ready` (with `❌` error in log) | Uncaught exception inside the respective async helper |

---

#### RBAC (Roles and Permissions)

Primordia uses a simple role-based access control system stored in SQLite.

**Roles** (seeded at boot, stored in the `roles` table):

| Role (internal name) | Default display name | Description |
|---|---|---|
| `admin` | Prime | Full system access. Automatically granted to the first user who registers. Cannot be granted via the API. |
| `can_evolve` | Evolver | Allows the user to access `/evolve` and submit change requests to Claude Code. Granted/revoked by admins via `/admin`. |

**Tables:**
- `roles` — catalog of all roles (name, id UUID, display_name, description, created_at). `name` is the immutable internal slug used in code and FK references; `display_name` is a customizable human-readable label shown in the UI.
- `user_roles` — maps users to roles (user_id, role_name, granted_by, granted_at)

**Key auth helpers in `lib/auth.ts`:**
- `isAdmin(userId)` — true if user has the `admin` role
- `hasEvolvePermission(userId)` — true if user has `admin` or `can_evolve` role

**Bootstrap:** The first user to register (via passkey or exe.dev login) is automatically granted the `admin` role. On DB startup, any existing first user without the role is backfilled. The `admin` role cannot be granted or revoked via the API — only via direct DB access.

---

#### Deploy to exe.dev (one-command remote dev server)
```
bun run deploy-to-exe.dev <server-name>
  → scp .env.local → <server-name>.exe.xyz
  → ssh: install git + bun if missing
  → ssh: git clone / git pull origin main
  → ssh: bun install
  → ssh: bun run build
  → ssh: systemd service starts `bun run start`
  → wait for "Ready" signal, tail logs
  → app is reachable at http://<server-name>.exe.xyz:3000
```

---

## Environment Variables

These must be set in:
- **Local development**: `.env.local` (copy from `.env.example`)
- **exe.dev**: `.env.local` is copied automatically by `scripts/deploy-to-exe-dev.sh`

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Required for evolve | Required for the evolve pipeline (`@anthropic-ai/claude-agent-sdk`) in **all environments**. Not required for chat on exe.dev — the built-in LLM gateway is used instead. Required for chat outside exe.dev. |
| `GITHUB_TOKEN` | No | Personal access token (repo scope) — enables authenticated git pull/push in GitSyncDialog; falls back to `origin` remote if unset |
| `GITHUB_REPO` | No | `owner/repo` slug (e.g. `primordia-org/primordia`) — used alongside `GITHUB_TOKEN` to build the authenticated remote URL |
| `REVERSE_PROXY_PORT` | No | Port the reverse proxy listens on (e.g. `3000`). When set, blue/green accepts use zero-downtime cutover instead of `systemctl restart`. |
| `PRIMORDIA_WORKTREES_DIR` | No | Path to the worktrees directory (default `/home/exedev/primordia-worktrees`). Set automatically by the systemd service files. |
| `NEXT_BASE_PATH` | No | URL sub-path prefix (e.g. `/primordia`) for hosting the app at a non-root path. Leave unset to serve from `/` (default). Sets both Next.js `basePath` config and `NEXT_PUBLIC_BASE_PATH` for client-side `fetch()` calls. Also set automatically on preview dev servers to `/preview/{sessionId}` when `REVERSE_PROXY_PORT` is active. |

---

## Setup Checklist (One-Time)

1. **Clone** this repo.
2. **Copy** `.env.example` to `.env.local` and fill in `ANTHROPIC_API_KEY` (required for the evolve pipeline in all environments; chat on exe.dev uses the built-in gateway instead).
3. **Run** `bun install && bun run dev`.
4. The app is live at `http://localhost:3000`.

To deploy to exe.dev: `bun run deploy-to-exe.dev <server-name>`

---

## Design Principles for Claude Code

When implementing changes, follow these principles:

1. **Read PRIMORDIA.md first.** Understand the current architecture before making changes.
2. **Minimal changes.** Only modify what is necessary for the user's request.
3. **No clever magic.** Write code that is easy for another AI to read and modify later.
4. **Minimal dependencies.** Every new dependency is a future maintenance burden. Avoid them unless essential.
5. **TypeScript everywhere.** Explicit types make the codebase more navigable for AI models.
6. **Tailwind for styling.** Do not add CSS files or CSS-in-JS libraries.
7. **App Router conventions.** Follow Next.js App Router patterns: `page.tsx`, `layout.tsx`, `route.ts`.
8. **Protected routes show a 403 page, not a redirect.** When a logged-in user visits a page they lack permission for, render `<ForbiddenPage>` in place of the normal page content. The 403 page must include: (a) a brief description of what the page does, (b) the full list of conditions required, (c) which conditions the user meets and doesn't meet, and (d) how they can gain access. Unauthenticated users (no session at all) may still be redirected to `/login` — that is a different case. Only use `redirect()` for the auth-absent case; use `<ForbiddenPage>` for the permission-absent case.
9. **Add exactly one changelog file per pull request.** After every set of changes, create a single new file in `changelog/` named `YYYY-MM-DD-HH-MM-SS Description of change.md` (UTC time, e.g. `2026-03-16-21-00-00 Fix login bug.md`). The filename is the short description; the file body is the full "what changed + why" detail in markdown. One PR = one changelog entry, even if the PR went through multiple iterations.

---

## Current Features

| Feature | Status | Notes |
|---|---|---|
| Chat interface (streaming) | ✅ Live | Streams from `claude-sonnet-4-6` via SSE |
| Evolve mode | ✅ Live | "Propose a change" in the hamburger opens a draggable/dockable floating dialog; `/evolve` page still exists as standalone |
| Local evolve pipeline | ✅ Live | git worktree → Claude Agent SDK → local preview → accept/reject |
| Evolve follow-up requests | ✅ Live | Chain multiple Claude passes on the same branch; form appears when session is ready |
| File attachments in evolve | ✅ Live | Attach images/files to initial and follow-up requests; files are copied into `worktree/attachments/` so Claude can read and use them |
| Upstream changes indicator | ✅ Live | Session page shows how many commits the parent branch is ahead of the session branch, with Merge and Rebase buttons |
| Git diff summary | ✅ Live | Session page shows a collapsible "Files changed" section (file names + +/- LOC) once the session is ready/accepted/rejected |
| Session from existing branch | ✅ Live | Branches page shows "+ session" next to branches with no active session; evolvers can attach the full AI preview pipeline to any pre-existing local branch |
| Upstream changes indicator | ✅ Live | Session page shows how many commits the parent branch is ahead of the session branch, with an "Apply Updates" button (merge only) |
| exe.dev deploy | ✅ Live | One-command SSH deploy; identical to local dev flow |
| Dark theme | ✅ Live | Default dark UI with Tailwind |
| Passkey authentication | ✅ Live | WebAuthn passkeys via /login; sessions stored in SQLite |
| Cross-device QR sign-in | ✅ Live | Laptop shows QR code; authenticated phone scans it and approves; laptop gets a session |
| RBAC (roles) | ✅ Live | Simple role system: `admin` (auto-granted to first user) and `can_evolve`; /admin page lets admin grant/revoke roles; protected pages show informative 403 instead of redirecting |
| Owner shell (/oops) | ✅ Live | Mobile-friendly shell at `/oops`; admin-only; run system commands (e.g. `sudo systemctl restart primordia`) without SSH; streams stdout+stderr via SSE |
| Server logs (/admin/logs) | ✅ Live | Admin-only; live tail of production server stdout/stderr via SSE; in production routes through `/_proxy/prod/logs` on the reverse proxy; falls back to `journalctl -u primordia` in local dev; accessible from the admin subnav |
| Proxy logs (/admin/proxy-logs) | ✅ Live | Admin-only; live tail of `journalctl -u primordia-proxy -f -n 100` via SSE; accessible from the admin subnav |
| Deep rollback (/admin/rollback) | ✅ Live | Admin-only; lists all previous production slots from primordia.productionHistory in git config; "Roll back" button for each target; zero-downtime cutover via reverse proxy |
| Read-only git HTTP | ✅ Live | Clone/fetch via `git clone http[s]://<host>/api/git`; proxied through `git http-backend`; push permanently blocked (403) |

---

## Stretch Goals (Not Implemented)

These were noted at project inception but are explicitly out of scope for the MVP:

- **Fork flow**: one-click fork to user's own instance
- **Voting**: upvote proposed evolve requests before they get built
- **Rollback UI / Deep rollback**: Implemented — `/admin/rollback` lists all previous slots from `primordia.productionHistory` in git config with one-click rollback buttons
- **Multi-tenant**: each user gets their own Primordia instance

## Changelog

> **Changelog entries are stored exclusively in `changelog/`** — never in this file.
> Each file is named `YYYY-MM-DD-HH-MM-SS Description.md`; the filename is the short description and the body has the full what+why detail.
> **One PR = one changelog entry.** Do not create multiple changelog files for a single pull request — consolidate all changes into one entry.
> The chat system prompt is built at runtime by `lib/system-prompt.ts`, which reads `PRIMORDIA.md` and the last 30 `changelog/` filenames on each request — no prebuild or codegen step needed. The `/changelog` page also reads `changelog/` directly at runtime. Having each entry as a separate timestamped file prevents merge conflicts.
> Do **not** add changelog bullets here.
