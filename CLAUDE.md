# CLAUDE.md

> **This file is the living brain of Primordia.**
> Every time Claude Code runs — whether triggered by the evolve pipeline or manually — it should:
> 1. **Read this file first** to understand the current state of the app.
> 2. **Update this file last** — keep it up to date and accurate.
>
> This file is the source of truth for architecture and features.

---

## What Is Primordia?

Primordia is a self-modifying web application. Users land on a marketing page, then propose changes to the app by opening the hamburger (☰) menu and choosing "Propose a change" — or navigating directly to the `/evolve` page. Requests are automatically built as local git worktree previews, powered by the Claude Agent SDK. Users then accept or reject each preview.

The core idea: **the app becomes whatever its users need it to be**, with no coding or git knowledge required from users.

---

## Current Architecture

### Tech Stack
| Layer | Technology | Why |
|---|---|---|
| Frontend framework | Next.js 16 (App Router) | AI models write Next.js well |
| Styling | Tailwind CSS | AI models write Tailwind well; no CSS files to manage |
| Language | TypeScript | Catches mistakes; Claude Code understands it well |
| AI API | Anthropic SDK (`@anthropic-ai/sdk`) | Routes through exe.dev LLM gateway by default; users may override with their own Anthropic API key or Claude Code credentials.json (stored in localStorage/DB, encrypted in transit via RSA-OAEP) |
| Hosting | exe.dev | Production builds via `bun run build && bun run start`; single systemd service (`primordia-proxy`) manages both proxy and production app; blue/green slot swap on accept |
| AI code gen | `@anthropic-ai/claude-agent-sdk` | `query()` runs Claude Code in git worktrees for evolve requests |
| Database | bun:sqlite | Local SQLite for passkey auth **and evolve session persistence**; same adapter on exe.dev and local dev |

### File Map

```
primordia/
├── CLAUDE.md                      ← You are here. Read me first, update me last.
├── README.md                      ← Public-facing project readme
├── LICENSE
├── .env.example                   ← Copy to .env.local, fill in secrets
├── .gitignore
├── instrumentation.ts             ← Next.js instrumentation hook; starts update-source background scheduler on server boot
├── next.config.ts                 ← Minimal Next.js config
├── tailwind.config.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── tsconfig.json
├── package.json
├── bun.d.ts                       ← Ambient TypeScript declarations for Bun built-ins (bun:sqlite, ImportMeta.dir)
├── openapi-gen.config.json        ← OpenAPI spec generation config for the internal REST API
│
├── changelog/                     ← One .md file per change: YYYY-MM-DD-HH-MM-SS Description.md
│   └── *.md                       ← Filename = short description; body = full what+why detail
│
├── scripts/
│   ├── reverse-proxy.ts          ← HTTP reverse proxy for zero-downtime blue/green AND preview servers; listens on REVERSE_PROXY_PORT; reads production branch from git config (primordia.productionBranch); discovers worktrees via $PRIMORDIA_DIR; captures prod server stdout/stderr in a 50 KB ring buffer; exposes POST /_proxy/prod/spawn (SSE) and GET /_proxy/prod/logs (SSE); watches .git/config for instant cutover; routes /preview/{branchName} to session preview servers (no slashes in branch names); installed to ~/primordia-proxy.ts by scripts/install.sh
│   ├── assign-branch-ports.sh    ← Idempotent migration script: assigns ephemeral ports to all local branches in git config (branch.{name}.port); main gets 3001, others get 3002+
│   ├── rollback.ts               ← Standalone CLI rollback script: updates primordia.productionBranch to the previous slot (second entry in primordia.productionHistory) and restarts primordia-proxy; use when the server itself is broken and /api/admin/rollback is unreachable
│   ├── install.sh                ← Primordia setup script; supports two invocation methods; idempotent
│   ├── claude-worker.ts          ← Standalone Claude Code worker process that handles LLM calls via exe.dev gateway
│   ├── pi-worker.ts              ← Standalone pi coding agent worker process; spawned as detached child surviving restarts
│   └── test-hmr-proxy.ts         ← Integration tests for reverse proxy WebSocket/HMR tunnel
│
├── public/
│   (no generated files)
│
├── lib/
│   ├── system-prompt.ts           ← Builds the evolve agent system prompt at runtime: reads CLAUDE.md + last 30 changelog filenames on each request
│   ├── auth.ts                    ← Session helpers: createSession, getSessionUser, isAdmin (admin role check), hasEvolvePermission (admin or can_evolve role)
│   ├── base-path.ts               ← basePath constant + withBasePath() helper; used by all client-side fetch() calls to prefix API routes when NEXT_BASE_PATH is set
│   ├── hooks.ts                   ← Shared React hooks: useSessionUser (fetches session on mount, provides logout)
│   ├── evolve-sessions.ts         ← Shared session state + business logic for local evolve; persists to SQLite
│   ├── page-title.ts              ← Utility: buildPageTitle() — formats <title> with port/branch suffix in development mode; clean title in production
│   ├── llm-client.ts              ← Creates Anthropic client: gateway (default) or direct API with user-supplied key
│   ├── llm-encryption.ts          ← Server-side RSA-OAEP keypair (ephemeral, per process); getPublicKeyJwk() + decryptApiKey()
│   ├── api-key-client.ts          ← Client-side helpers: getStoredApiKey/setStoredApiKey (localStorage) + encryptStoredApiKey() (RSA-OAEP)
│   ├── agent-config.ts            ← Definitions for supported coding agent harnesses and model options
│   ├── auto-canonical.ts          ← On first request, derives and persists canonical URL from request origin if not already set
│   ├── credentials-client.ts      ← Client-side AES-256-GCM encryption helpers for storing Claude Code credentials.json
│   ├── cross-device-creds.ts      ← ECDH P-256 helpers for credential transfer in pull and push cross-device sign-in flows
│   ├── pi-model-registry.server.ts ← Builds model option list at runtime from pi ModelRegistry for both claude-code and pi harnesses
│   ├── public-origin.ts           ← Utility for deriving public-facing origin from request, respecting x-forwarded-* headers
│   ├── register-with-parent.ts    ← Posts instance identity to parent's registration endpoint and returns status string
│   ├── session-events.ts          ← Structured event types for session progress logs stored as NDJSON in worktree
│   ├── smart-preview-url.ts       ← Infers the most relevant preview page path from LLM text output in session events
│   ├── update-source-scheduler.ts ← Background scheduler that automatically fetches update sources per frequency settings
│   ├── update-sources.ts          ← Manages git-based update sources via git config remote.{id}.* namespace
│   ├── user-prefs.ts              ← Server-side helpers for reading per-user preferences (harness, model, caveman) from database
│   ├── uuid7.ts                   ← UUID v7 helper (delegates to the `uuid` npm package)
│   ├── validate-canonical-url.ts  ← Validation for Canonical URL field (HTTPS, non-localhost)
│   ├── auth-providers/            ← Auth provider system (no registry — auto-discovered by login page)
│   │   ├── types.ts               ← AuthPlugin, AuthPluginServerContext, InstalledPlugin, AuthTabProps
│   │   ├── passkey/index.ts       ← default export: passkeyPlugin descriptor
│   │   ├── exe-dev/index.ts       ← default export: exeDevPlugin (reads X-ExeDev-Email header)
│   │   └── cross-device/index.ts  ← default export: crossDevicePlugin
│   └── db/
│       ├── index.ts               ← Factory: getDb() → SQLite (always)
│       ├── types.ts               ← Shared DB types: User, Passkey, Challenge, Session, CrossDeviceToken, EvolveSession, Role; DbAdapter includes role methods
│       └── sqlite.ts              ← bun:sqlite adapter (includes evolve_sessions, roles, user_roles tables; seeds built-in roles on boot)
│
├── components/auth-tabs/            ← Client-side auth tab components (no registry — loaded via dynamic import)
│   ├── passkey/index.tsx            ← default export: PasskeyTab
│   ├── exe-dev/index.tsx            ← default export: ExeDevTab
│   └── cross-device/index.tsx      ← default export: CrossDeviceTab
│
├── components/
│   ├── AdminSubNav.tsx            ← Tab subnav for admin pages: "Manage Users" (/admin), "Server Logs" (/admin/logs), "Proxy Logs" (/admin/proxy-logs), "Rollback" (/admin/rollback), "Server Health" (/admin/server-health), "Git Mirror" (/admin/git-mirror), "Instance" (/admin/instance), "Updates" (/admin/updates)
│   ├── AnsiRenderer.tsx           ← Renders text with ANSI escape codes as styled React elements (colors, bold, spinner overwrite)
│   ├── ApiKeyDialog.tsx           ← Modal for setting/clearing user Anthropic API key; stores in localStorage; opened from hamburger menu
│   ├── CredentialsDialog.tsx      ← Modal dialog for pasting Claude Code credentials.json with AES-256-GCM encryption
│   ├── EvolveRequestForm.tsx      ← Shared evolve request form with harness/model selection, attachments, and element inspector
│   ├── FloatingEvolveDialog.tsx   ← Draggable, dockable floating popup with the evolve form; opened from hamburger "Propose a change" on any page
│   ├── ForbiddenPage.tsx          ← Server component: 403 access-denied page with page description, required/met/unmet conditions, and how-to-fix
│   ├── HamburgerMenu.tsx          ← Reusable hamburger button + dropdown; used by ChatInterface, EvolveForm, EvolveSessionView, PageNavBar
│   ├── MarkdownContent.tsx        ← Block-prose markdown renderer with dark styling used on session pages and changelogs
│   ├── NavHeader.tsx              ← Shared nav header (title, branch name, nav links)
│   ├── PageElementInspector.tsx   ← Full-screen portal overlay for picking DOM elements on current page with screenshot capture
│   ├── PageNavBar.tsx             ← Shared nav header + hamburger for /changelog and /branches pages
│   ├── QrSignInOtherDeviceDialog.tsx ← Dialog for authenticated users to initiate push cross-device sign-in with QR code
│   ├── ServerLogsClient.tsx       ← Client component: live tail of primordia systemd journal via SSE (/admin/logs)
│   └── SimpleMarkdown.tsx         ← Minimal markdown renderer (bold, links, inline code, code blocks)
│
└── app/                           ← Next.js App Router
    ├── layout.tsx                 ← Root layout (font, metadata, body styling)
    ├── page.tsx                   ← Landing page — marketing/feature overview; links to /evolve and /login
    ├── globals.css                ← Tailwind base imports only
    ├── icon.png                   ← App favicon
    ├── ChangelogNewsticker.tsx    ← Server component: renders last 12 changelog entries as an animated horizontal newsticker
    ├── CopyButton.tsx             ← Client button: copies text to clipboard with visual feedback
    ├── InstallBlock.tsx           ← Interactive install UI block with SSH command and live VM name input
    ├── LandingNav.tsx             ← Floating hamburger menu in top-right of landing page with lazy-loaded evolve dialog
    ├── LandingSections.tsx        ← Server components for each landing page section (hero, features, how-it-works, etc.)
    ├── ansi-test/
    │   └── page.tsx               ← Interactive test page for AnsiRenderer with pre-baked samples and live streaming
    ├── branches/
    │   ├── page.tsx               ← Server component: git branch tree; publicly viewable; admin-only actions conditionally hidden
    │   └── CreateSessionFromBranchButton.tsx ← Client component: "+ session" button; inline form to start a session on an existing branch
    ├── changelog/
    │   ├── page.tsx               ← Server component: reads changelog/ filenames at runtime; lazy-loads body via /api/changelog
    │   └── ChangelogEntryDetails.tsx ← Client component: single changelog <details> widget; lazy-loads body from /api/changelog on first open
    ├── admin/
    │   ├── page.tsx               ← Admin panel: grant/revoke evolve access per user; tab subnav
    │   ├── AdminPermissionsClient.tsx ← Client component: grant/revoke 'can_evolve' role per user
    │   ├── git-mirror/
    │   │   ├── page.tsx           ← Git Mirror: shows mirror remote status and SSH instructions; admin only
    │   │   └── GitMirrorClient.tsx ← Client component: add/remove mirror remote
    │   ├── instance/
    │   │   ├── page.tsx           ← Instance identity admin panel: view/edit name+description+uuid7; view graph nodes+edges; admin only
    │   │   └── InstanceConfigClient.tsx ← Client component for instance config editing and graph display
    │   ├── logs/
    │   │   └── page.tsx           ← Server logs: pre-fetches initial log buffer; delegates live tail to ServerLogsClient; admin only
    │   ├── proxy-logs/
    │   │   └── page.tsx           ← Proxy logs: pre-fetches first 100 journalctl lines; delegates live tail to ServerLogsClient; admin only
    │   ├── rollback/
    │   │   ├── page.tsx           ← Deep rollback: lists previous prod slots from primordia.productionHistory; admin only
    │   │   └── AdminRollbackClient.tsx ← Client component: deep rollback UI with roll-back buttons per slot
    │   ├── server-health/
    │   │   ├── page.tsx           ← Server health: disk/memory usage and oldest non-prod worktree cleanup; admin only
    │   │   └── AdminServerHealthClient.tsx ← Client component: disk/memory bars and worktree delete button
    │   └── updates/
    │       ├── page.tsx           ← Fetch Updates admin page for pulling upstream Primordia changes; admin only
    │       └── UpdatesClient.tsx  ← Client component: multiple update sources with fetch/merge controls
    ├── evolve/
    │   ├── page.tsx               ← Dedicated "propose a change" page; renders <EvolveRequestForm>; requires evolve permission
    │   └── session/
    │       └── [id]/
    │           ├── page.tsx               ← Session-tracking page; publicly viewable; passes canEvolve to hide actions for non-evolvers
    │           ├── EvolveSessionView.tsx  ← Client component: streams live session progress via SSE; shows preview, diffs, actions
    │           ├── DiffFileExpander.tsx   ← Expandable file row in git diff summary table; lazy-loads colorized diffs
    │           ├── HorizontalResizeHandle.tsx ← Drag handle for resizing two-panel horizontal flex layouts
    │           └── WebPreviewPanel.tsx    ← Inline browser-like preview panel with Back/Forward/Refresh and element inspector mode
    ├── install.sh/
    │   └── route.ts               ← Returns install.sh script with origins/base paths rewritten for the current instance
    ├── login/
    │   ├── page.tsx               ← Server component: auto-discovers providers via readdirSync(lib/auth-providers/); passes to LoginClient
    │   ├── LoginClient.tsx        ← Client component: renders one tab per provider; loads tab components via next/dynamic
    │   ├── approve/
    │   │   └── page.tsx           ← Approval page: authenticated device approves a QR cross-device sign-in
    │   └── cross-device-receive/
    │       └── page.tsx           ← Receive page: new device scanning QR completes cross-device push sign-in flow
    ├── markdown-test/
    │   └── page.tsx               ← Interactive test page for MarkdownContent with speed and chunk-size controls
    ├── register-passkey/
    │   ├── page.tsx               ← Server component: shown after exe.dev login when user has no passkeys yet
    │   └── RegisterPasskeyClient.tsx ← Client component: prompts logged-in users to register a passkey
    ├── schemas/
    │   └── instance/v1.json/
    │       └── route.ts           ← Serves the JSON Schema for Primordia instance manifests
    └── api/
        ├── changelog/route.ts         ← GET ?filename=...: returns raw markdown body of one changelog file (lazy-load)
        ├── git/[...path]/route.ts     ← GET/POST git http-backend proxy (read-only clone/fetch); push blocked with 403
        ├── markdown-stream/route.ts   ← Streams markdown sample character-by-character via SSE (for testing MarkdownContent)
        ├── openapi/route.ts           ← Serves OpenAPI spec, generating on first request if not on disk
        ├── prune-branches/route.ts    ← Returns 410 Gone (superseded endpoint)
        ├── rollback/route.ts          ← Returns 410 Gone (superseded by /api/admin/rollback)
        ├── auth/
        │   ├── session/route.ts       ← GET current session user
        │   ├── logout/route.ts        ← POST clear session
        │   ├── exe-dev/route.ts       ← GET exe.dev SSO login: reads injected headers, creates/finds user + session
        │   ├── passkey/
        │   │   ├── register/start/route.ts  ← Generate WebAuthn registration options
        │   │   ├── register/finish/route.ts ← Verify registration, create user+session
        │   │   ├── login/start/route.ts     ← Generate WebAuthn authentication options
        │   │   └── login/finish/route.ts    ← Verify authentication, create session
        │   └── cross-device/
        │       ├── start/route.ts     ← POST create a cross-device token (pull flow); returns tokenId
        │       ├── poll/route.ts      ← GET poll token status; sets session cookie on approval
        │       ├── approve/route.ts   ← POST approve a token (requires auth on approver device)
        │       ├── push/route.ts      ← POST create pre-approved cross-device token (push flow) with encrypted credentials
        │       └── qr/route.ts        ← GET SVG QR code encoding the approval URL for a tokenId
        ├── evolve/
        │   ├── route.ts               ← POST start session (requires can_evolve permission), GET status (legacy poll)
        │   ├── stream/route.ts        ← GET SSE stream of live session progress
        │   ├── manage/route.ts        ← POST accept/reject a local session
        │   ├── followup/route.ts      ← POST submit a follow-up request on an existing ready session
        │   ├── abort/route.ts         ← POST abort the running Claude Code instance; transitions session to ready
        │   ├── kill-restart/route.ts  ← POST kill dev server process + restart it in the worktree
        │   ├── upstream-sync/route.ts ← POST merge parent branch into session worktree ("Apply Updates")
        │   ├── from-branch/route.ts   ← POST start a session on an existing local branch (external contributor workflow)
        │   ├── diff/route.ts          ← GET raw unified diff for a single file in a session branch vs its parent
        │   ├── diff-summary/route.ts  ← GET per-file diff summary (additions + deletions) for all changed files in a session
        │   ├── models/route.ts        ← GET available model options grouped by agent harness from the pi ModelRegistry
        │   ├── reset-stuck/route.ts   ← POST force-reset sessions stuck in 'accepting'/'fixing-types' back to 'ready'
        │   └── attachment/[sessionId]/route.ts ← GET serve user-uploaded attachment files from a session's worktree
        ├── llm-key/
        │   ├── public-key/route.ts        ← GET server's ephemeral RSA-OAEP public key as JWK
        │   ├── encrypted-key/route.ts     ← Store/retrieve AES-GCM encrypted API key ciphertext
        │   └── encrypted-credentials/route.ts ← Store/retrieve AES-GCM encrypted Claude Code credentials.json
        ├── admin/
        │   ├── permissions/route.ts   ← POST grant/revoke grantable roles (can_evolve); admin only
        │   ├── logs/route.ts          ← GET SSE stream of production server logs; admin only
        │   ├── proxy-logs/route.ts    ← GET SSE stream of journalctl -u primordia-proxy; admin only
        │   ├── rollback/route.ts      ← GET/POST previous prod slots from primordia.productionHistory; admin only
        │   ├── server-health/route.ts ← GET disk/memory usage; POST delete oldest worktree; admin only
        │   ├── git-mirror/route.ts    ← GET/POST/DELETE manage "mirror" git remote for push mirroring; admin only
        │   ├── proxy-settings/route.ts ← GET/PATCH reverse proxy configuration from git config; admin only
        │   └── updates/route.ts       ← POST manage upstream update sources and create merge sessions; admin only
        └── instance/
            ├── config/route.ts        ← GET/PATCH instance metadata (uuid7, name, description, URLs)
            ├── primordia-json/route.ts ← GET instance identity + social graph at /.well-known/primordia.json
            └── register/route.ts      ← POST allows child Primordia instances to register as graph nodes
```

### Data Flow

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
  → git worktree add $PRIMORDIA_DIR/worktrees/{branchName} -b {branchName}
       ($PRIMORDIA_DIR is set by the installer — the repo root for fresh installs, two levels above the worktree for worktree-based installs; branches with slashes not supported)
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
          → sibling sessions whose git config parent = parentBranch are reparented to session branch (so "Apply Updates" picks up new prod)
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

---

## Environment Variables

These must be set in:
- **Local development**: `.env.local` (copy from `.env.example`)
- **exe.dev**: `.env.local` is created by `scripts/install.sh` during provisioning

| Variable | Required | Description |
|---|---|---|
| `REVERSE_PROXY_PORT` | Yes | Port the reverse proxy listens on (e.g. `3000`). Blue/green accepts and rollbacks use zero-downtime cutover via the proxy. |
| `PRIMORDIA_DIR` | No | Root directory of the Primordia installation. Set by the installer in the systemd service — not intended for manual configuration. Fresh installs: repo root. Worktree installs: two levels above the worktree (`$PRIMORDIA_DIR/worktrees/{branch}`). |
| `NEXT_BASE_PATH` | No | URL sub-path prefix (e.g. `/primordia`) for hosting the app at a non-root path. Leave unset to serve from `/` (default). Sets both Next.js `basePath` config and `NEXT_PUBLIC_BASE_PATH` for client-side `fetch()` calls. Also set automatically on preview dev servers to `/preview/{sessionId}` when `REVERSE_PROXY_PORT` is active. |

---

## Setup Checklist (One-Time)

1. **Clone** this repo.
2. **Copy** `.env.example` to `.env.local` and fill in `REVERSE_PROXY_PORT`.
3. **Run** `bun install && bun run dev`.
4. The app is live at `http://localhost:3000`.

To deploy to exe.dev: `bun run deploy-to-exe.dev <server-name>`

---

## Worktree Session History (NDJSON Log)

Every evolve worktree keeps a structured event log at `.primordia-session.ndjson` (one JSON object per line). This file is the single source of truth for session state — it records the initial request, every follow-up request, all agent tool calls and text output, result status, and metrics for each run.

When an agent is invoked for a follow-up request it typically resumes its own session (`useContinue: true`) and already has full conversation history. If for any reason the agent has no native memory of prior work in the worktree (e.g. a fresh start or a harness that does not support session resumption), read `.primordia-session.ndjson` to reconstruct context:

- `initial_request` events contain the original change request text.
- `followup_request` events contain each subsequent request, in order.
- `section_start` events with `sectionType: 'agent'` identify which harness and model ran each phase.
- `result` events record whether each phase succeeded, errored, timed out, or was aborted.

The log is append-only and never truncated for the lifetime of the session.

---

## Git Config as Key-Value Store

Primordia uses `.git/config` as a lightweight key-value store for **non-sensitive runtime state** (no secrets — use `.env.local`; no user data — use SQLite). The reverse proxy reads it directly without starting Next.js.

### Established namespaces

| Namespace | Example key | What it stores |
|---|---|---|
| `primordia.*` | `primordia.productionBranch` | App-wide settings; proxy reads these live via `fs.watch` on `.git/config` |
| `primordia.*` | `primordia.productionHistory` | Multi-value list of previous production branch names (written with `--add`) |
| `primordia.*` | `primordia.previewInactivityMin` | Proxy tuning knobs (see `app/api/admin/proxy-settings/route.ts`) |
| `branch.{name}.*` | `branch.main.port` | Per-branch ephemeral port; proxy discovers preview servers this way |
| `branch.{name}.*` | `branch.feature-x.parent` | Parent branch recorded at worktree creation for upstream-sync |
| `remote.{name}.*` | `remote.primordia-official.updateSource` | Update source metadata extending the standard git remote section (see `lib/update-sources.ts`) |

### Output format of `--get-regexp`

Each line is `<key><space><value>` with no `=`. Git **lowercases the section and field names** but **preserves the subsection name's case**. Always split on the first space. Use `[^.]+` (not `.*`) in regexes to avoid greedy matches across dots.

### Code reference

See `lib/update-sources.ts` for the subsection pattern. See `lib/evolve-sessions.ts` (`getOrAssignBranchPort`) for a simple single-key read/write example.

---

## Design Principles for Claude Code

When implementing changes, follow these principles:

1. **Read CLAUDE.md first.** Understand the current architecture before making changes.
2. **Minimal changes.** Only modify what is necessary for the user's request.
3. **No clever magic.** Write code that is easy for another AI to read and modify later.
4. **Minimal dependencies.** Every new dependency is a future maintenance burden. Avoid them unless essential.
5. **TypeScript everywhere.** Explicit types make the codebase more navigable for AI models.
6. **Tailwind for styling.** Do not add CSS files or CSS-in-JS libraries.
7. **App Router conventions.** Follow Next.js App Router patterns: `page.tsx`, `layout.tsx`, `route.ts`.
8. **Protected routes show a 403 page, not a redirect.** When a logged-in user visits a page they lack permission for, render `<ForbiddenPage>` in place of the normal page content. The 403 page must include: (a) a brief description of what the page does, (b) the full list of conditions required, (c) which conditions the user meets and doesn't meet, and (d) how they can gain access. Unauthenticated users (no session at all) may still be redirected to `/login` — that is a different case. Only use `redirect()` for the auth-absent case; use `<ForbiddenPage>` for the permission-absent case.
9. **Prefer Lucide for icons.** Use `lucide-react` for all icons. Do not reach for other icon libraries (heroicons, react-icons, etc.) unless a specific icon is unavailable in Lucide.
10. **Add exactly one changelog file per pull request.** After every set of changes, create a single new file in `changelog/` named `YYYY-MM-DD-HH-MM-SS Description of change.md` (UTC time, e.g. `2026-03-16-21-00-00 Fix login bug.md`). The filename is the short description; the file body is the full "what changed + why" detail in markdown. One PR = one changelog entry, even if the PR went through multiple iterations.

---

## Current Features

| Feature | Status | Notes |
|---|---|---|
| Evolve mode | ✅ Live | "Propose a change" in the hamburger opens a draggable/dockable floating dialog; `/evolve` page also exists as standalone |
| Local evolve pipeline | ✅ Live | git worktree → Claude Agent SDK → local preview → accept/reject |
| Evolve follow-up requests | ✅ Live | Chain multiple Claude passes on the same branch; form appears when session is ready |
| File attachments in evolve | ✅ Live | Attach images/files to initial and follow-up requests; files are copied into `worktree/attachments/` so Claude can read and use them |
| Multiple agent harnesses | ✅ Live | Evolve form lets users choose harness (claude-code or pi) and model; preferences persisted per-user in DB |
| Upstream changes indicator | ✅ Live | Session page shows how many commits the parent branch is ahead of the session branch, with an "Apply Updates" button (merge only) |
| Git diff summary | ✅ Live | Session page shows a collapsible "Files changed" section (file names + +/- LOC) once the session is ready/accepted/rejected |
| Session from existing branch | ✅ Live | Branches page shows "+ session" next to branches with no active session; evolvers can attach the full AI preview pipeline to any pre-existing local branch |
| Upstream updates (/admin/updates) | ✅ Live | Admin-only; pull upstream Primordia changes from configured update sources; auto-scheduled fetches |
| exe.dev deploy | ✅ Live | One-command SSH deploy via `bun run deploy-to-exe.dev <server-name>` |
| Dark theme | ✅ Live | Default dark UI with Tailwind |
| Passkey authentication | ✅ Live | WebAuthn passkeys via /login; sessions stored in SQLite |
| Cross-device QR sign-in | ✅ Live | Laptop shows QR code; authenticated phone scans it and approves; laptop gets a session |
| Credentials management | ✅ Live | Users can paste Claude Code credentials.json via the hamburger menu; stored AES-256-GCM encrypted in DB |
| RBAC (roles) | ✅ Live | Simple role system: `admin` (auto-granted to first user) and `can_evolve`; /admin page lets admin grant/revoke roles; protected pages show informative 403 instead of redirecting |
| Server logs (/admin/logs) | ✅ Live | Admin-only; live tail of production server stdout/stderr via SSE; routes through `/_proxy/prod/logs` in production |
| Proxy logs (/admin/proxy-logs) | ✅ Live | Admin-only; live tail of `journalctl -u primordia-proxy -f -n 100` via SSE |
| Deep rollback (/admin/rollback) | ✅ Live | Admin-only; lists all previous production slots from primordia.productionHistory in git config; "Roll back" button for each target; zero-downtime cutover via reverse proxy |
| Server health (/admin/server-health) | ✅ Live | Admin-only; disk and memory usage with visual bars; oldest non-prod worktree cleanup |
| Git mirror (/admin/git-mirror) | ✅ Live | Admin-only; every production deploy auto-pushes to `mirror` remote if it exists |
| Instance identity & social graph | ✅ Live | Each instance has a fixed UUID v7, editable name+description; serves `/.well-known/primordia.json` with self+peers+edges; `/api/instance/register` lets child instances POST to register; admin panel at `/admin/instance` |
| Read-only git HTTP | ✅ Live | Clone/fetch via `git clone http[s]://<host>/api/git`; proxied through `git http-backend`; push permanently blocked (403) |
| OpenAPI spec | ✅ Live | Served at `/api/openapi`; generated on first request from `openapi-gen.config.json` |

## Changelog

> **Changelog entries are stored exclusively in `changelog/`** — never in this file.
> Each file is named `YYYY-MM-DD-HH-MM-SS Description.md`; the filename is the short description and the body has the full what+why detail.
> **One PR = one changelog entry.** Do not create multiple changelog files for a single pull request — consolidate all changes into one entry.
> The evolve agent system prompt is built at runtime by `lib/system-prompt.ts`, which reads `CLAUDE.md` and the last 30 `changelog/` filenames on each request — no prebuild or codegen step needed. The `/changelog` page also reads `changelog/` directly at runtime. Having each entry as a separate timestamped file prevents merge conflicts.
> Do **not** add changelog bullets here.
