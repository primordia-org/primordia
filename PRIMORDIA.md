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
| Hosting | exe.dev | Production builds via `bun run build && bun run start`; systemd service; blue/green slot swap on accept |
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
│   ├── install-service.sh        ← Installs/re-installs the systemd service; creates primordia-worktrees/current symlink (blue/green bootstrap)
│   └── primordia.service         ← systemd service unit file; WorkingDirectory points at primordia-worktrees/current (the active blue/green slot)
│
├── public/
│   (no generated files)
│
├── lib/
│   ├── system-prompt.ts           ← Builds chat system prompt at runtime: reads PRIMORDIA.md + last 30 changelog filenames on each request
│   ├── auth.ts                    ← Session helpers: createSession, getSessionUser, isAdmin (admin role check), hasEvolvePermission (admin or can_evolve role)
│   ├── hooks.ts                   ← Shared React hooks: useSessionUser (fetches session on mount, provides logout)
│   ├── evolve-sessions.ts         ← Shared session state + business logic for local evolve; persists to SQLite
│   ├── page-title.ts              ← Utility: buildPageTitle() — formats <title> with branch/port suffix on non-main branches
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
│   │   └── page.tsx               ← Admin panel: owner-only; grant/revoke evolve access per user
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
│       ├── oops/
│       │   └── route.ts           ← POST run shell command (streams SSE stdout+stderr); admin only
│       ├── admin/
│       │   └── permissions/
│       │       └── route.ts       ← POST grant/revoke grantable roles (can_evolve); admin only
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
│               └── upstream-sync/
│                   └── route.ts   ← POST merge or rebase parent branch into session worktree
│
├── components/
│   ├── AcceptRejectBar.tsx        ← Accept/reject bar for local preview worktrees
│   ├── AdminPermissionsClient.tsx ← Client component: grant/revoke 'can_evolve' role per user (used by /admin)
│   ├── ForbiddenPage.tsx          ← Server component: 403 access-denied page with page description, required/met/unmet conditions, and how-to-fix
│   ├── ChatInterface.tsx          ← Main chat UI (chat only); hamburger menu "Propose a change" links to /evolve
│   ├── ChangelogEntryDetails.tsx  ← Client component: single changelog <details> widget; lazy-loads body from /api/changelog on first open
│   ├── EvolveForm.tsx             ← "Submit a request" form; POSTs then redirects to /evolve/session/{id}
│   ├── EvolveSessionView.tsx      ← Client component for session tracking page; streams live progress via SSE
│   ├── GitSyncDialog.tsx          ← Modal: git pull + push via /api/git-sync (wraps StreamingDialog)
│   ├── HamburgerMenu.tsx          ← Reusable hamburger button + dropdown; used by ChatInterface, EvolveForm, EvolveSessionView, PageNavBar
│   ├── LandingNav.tsx             ← Landing page navbar with mobile hamburger collapse
│   ├── OopsShell.tsx              ← Client component: mobile-friendly shell for /oops; streams command output via SSE
│   ├── NavHeader.tsx              ← Shared nav header (title, branch name, nav links)
│   ├── PageNavBar.tsx             ← Shared nav header + hamburger for /changelog and /branches pages
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
  → spawn: bun run dev in worktree; Next.js picks its own port
  → EvolveSessionView opens SSE stream to /api/evolve/stream?sessionId=...
      → GET streams delta progressText + state every 500 ms from SQLite until terminal
  → Preview link shown when status becomes "ready"
  → User clicks Accept → POST /api/evolve/manage { action: "accept" }
      → pre-accept gates: ancestor check, clean worktree, bun run typecheck, bun run build (all in session worktree)
      → blue/green deploy (production): bun install in worktree → git commit-tree + update-ref (no production dir writes)
          → copy prod DB from old slot into new slot (preserves auth data)
          → fix .env.local symlink in new slot to point to main repo (prevents dangling link)
          → atomic symlink swap: primordia-worktrees/current → session worktree
          → keep old slot as primordia-worktrees/previous (enables fast rollback via POST /api/rollback)
          → delete slot from two accepts ago (if worktree), delete session branch
          → sudo systemctl restart primordia (fire-and-forget)
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
| `ready` | Claude Code finished; worktree is live and interactive |
| `accepted` | User clicked Accept; branch merged into parent, worktree deleted |
| `rejected` | User clicked Reject; worktree and branch discarded without merging |
| `error` | An exception was thrown during `starting` or `running-claude` |

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
| `fixing-types` → `error` | `runFollowupInWorktree()` success but type/build errors persist after fix, or merge fails |
| `ready` → `accepted` / `rejected` | `POST /api/evolve/manage` |
| devServer `running` → `disconnected` | Dev server `close` event + branch still present (3 s later) |
| devServer `disconnected` → `starting` | `POST /api/evolve/kill-restart` |
| any → `error` | Uncaught exception inside the respective async helper |

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
| `ANTHROPIC_API_KEY` | Conditional | Powers the chat interface. **Not required on exe.dev** — the built-in LLM gateway is used instead (no key needed). Required when running outside exe.dev as a fallback. |
| `GITHUB_TOKEN` | No | Personal access token (repo scope) — enables authenticated git pull/push in GitSyncDialog; falls back to `origin` remote if unset |
| `GITHUB_REPO` | No | `owner/repo` slug (e.g. `primordia-org/primordia`) — used alongside `GITHUB_TOKEN` to build the authenticated remote URL |

---

## Setup Checklist (One-Time)

1. **Clone** this repo.
2. **Copy** `.env.example` to `.env.local` and fill in `ANTHROPIC_API_KEY` (not needed on exe.dev — the built-in gateway is used automatically).
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
| Evolve mode | ✅ Live | Dedicated `/evolve` page; accessible via "Propose a change" in the hamburger menu |
| Local evolve pipeline | ✅ Live | git worktree → Claude Agent SDK → local preview → accept/reject |
| Evolve follow-up requests | ✅ Live | Chain multiple Claude passes on the same branch; form appears when session is ready |
| File attachments in evolve | ✅ Live | Attach images/files to initial and follow-up requests; files are copied into `worktree/attachments/` so Claude can read and use them |
| Upstream changes indicator | ✅ Live | Session page shows how many commits the parent branch is ahead of the session branch, with Merge and Rebase buttons |
| exe.dev deploy | ✅ Live | One-command SSH deploy; identical to local dev flow |
| Dark theme | ✅ Live | Default dark UI with Tailwind |
| Passkey authentication | ✅ Live | WebAuthn passkeys via /login; sessions stored in SQLite |
| Cross-device QR sign-in | ✅ Live | Laptop shows QR code; authenticated phone scans it and approves; laptop gets a session |
| RBAC (roles) | ✅ Live | Simple role system: `admin` (auto-granted to first user) and `can_evolve`; /admin page lets admin grant/revoke roles; protected pages show informative 403 instead of redirecting |
| Owner shell (/oops) | ✅ Live | Mobile-friendly shell at `/oops`; admin-only; run system commands (e.g. `sudo systemctl restart primordia`) without SSH; streams stdout+stderr via SSE |

---

## Stretch Goals (Not Implemented)

These were noted at project inception but are explicitly out of scope for the MVP:

- **Fork flow**: one-click fork to user's own instance
- **Voting**: upvote proposed evolve requests before they get built
- **Rollback UI**: A dedicated UI for the `POST /api/rollback` endpoint (endpoint exists; no UI yet)
- **Deep rollback**: "go back to before X was added" via natural language (only one level of rollback is available today via `previous`)
- **Multi-tenant**: each user gets their own Primordia instance

## Changelog

> **Changelog entries are stored exclusively in `changelog/`** — never in this file.
> Each file is named `YYYY-MM-DD-HH-MM-SS Description.md`; the filename is the short description and the body has the full what+why detail.
> **One PR = one changelog entry.** Do not create multiple changelog files for a single pull request — consolidate all changes into one entry.
> The chat system prompt is built at runtime by `lib/system-prompt.ts`, which reads `PRIMORDIA.md` and the last 30 `changelog/` filenames on each request — no prebuild or codegen step needed. The `/changelog` page also reads `changelog/` directly at runtime. Having each entry as a separate timestamped file prevents merge conflicts.
> Do **not** add changelog bullets here.
