# CLAUDE.md

> **This file is the living brain of Primordia.**
> Every time Claude Code runs — whether triggered by the thread pipeline or manually — it should:
> 1. **Read this file first** to understand the current state of the app.
> 2. **Update this file last** — keep it up to date and accurate.
>
> This file is the source of truth for architecture and features.

---

## What Is Primordia?

Primordia is a self-modifying web application. Users land on a marketing page, then propose changes to the app by opening the hamburger (☰) menu and choosing "Propose a change" — or navigating directly to the `/thread` page. Requests are automatically built as local git worktree previews, powered by the Claude Agent SDK. Users then accept or reject each preview.

The core idea: **the app becomes whatever its users need it to be**, with no coding or git knowledge required from users.

---

## Current Architecture

### Tech Stack
| Layer | Technology | Why |
|---|---|---|
| Frontend framework | Next.js 16 (App Router) | AI models write Next.js well |
| Styling | Tailwind CSS | AI models write Tailwind well; no CSS files to manage |
| Language | TypeScript | Catches mistakes; Claude Code understands it well |
| AI API | Anthropic SDK (`@anthropic-ai/sdk`) | Routes through exe.dev LLM gateway by default; users may override with their own API keys, Claude Code credentials.json, or ChatGPT subscription OAuth. Secrets are stored encrypted in SQLite with the browser-held `primordia_aes_key`; web thread requests still send that AES key for compatibility, while `/settings/api-keys` issues revokable API-key wrappers for CLI and web clients. Workers receive only the resolved AES key internally and call `decryptStoredSecretForUser` for the selected user/source. |
| Hosting | exe.dev | Production builds via `bun run build && bun run start`; app scripts set `NEXT_DEPLOYMENT_ID` from the current git commit so Next.js skew protection refreshes stale clients across deploys; the Next CLI is invoked directly with `bun --bun ./node_modules/next/dist/bin/next ...` so long-running app servers do not fall through the package-bin `node` shebang; single systemd service (`primordia`) runs a small Primordia service-supervisor, which keeps detached `reverse-proxy.js` and `scheduled-jobs.js` service processes alive without restarting them when the supervisor itself restarts; blue/green slot swap on accept |
| Runtime versioning | mise (`mise.toml`) | Pins Bun per worktree; thread setup trusts `mise.toml`, and the reverse proxy launches worktree servers with `mise exec -C <worktree>` |
| CLI framework | Internal tiny CLI helper (`lib/tiny-cli.ts`) | Organizes `bun run primordia` subcommands, detailed handwritten-style help, argument/option parsing, JSON automation output, and generated bash completion with dynamic completion hooks |
| AI code gen | `@anthropic-ai/claude-agent-sdk`, `@earendil-works/pi-coding-agent`, and Codex CLI | Thread workers run Claude Code, Pi, or Codex in git worktrees for user requests; Primordia keeps a generated model list from the pi SDK for model/preset UIs |
| Database | bun:sqlite | Local SQLite for passkey auth **and thread/session persistence**; same adapter on exe.dev and local dev |
| Package install security | Bun `minimumReleaseAge` + `@socketsecurity/bun-security-scanner` | New package resolutions must be at least 24 hours old and are scanned by Socket during `bun install` |

### File Map

Detailed annotations for each directory are in path-scoped rules files (`.claude/rules/filemap-*.md`) — Claude Code loads them automatically when you work in the relevant directory. The overview below covers root-level files and top-level directories.

```
primordia/
├── CLAUDE.md                      ← You are here. Read me first, update me last.
├── README.md                      ← Public-facing project readme
├── LICENSE
├── .env.example                   ← Template for manual source checkouts; install.sh writes production .env.local automatically
├── .gitignore
├── instrumentation.ts             ← Next.js instrumentation hook; reconnects/recover thread workers on server boot; scheduled jobs run through the supervised Primordia Core jobs daemon instead
├── bunfig.toml                    ← Bun package install hardening: 24h minimum release age + Socket scanner
├── mise.toml                      ← Runtime version pin; currently Bun 1.3.13; install.sh copies it to $PRIMORDIA_DIR for the copied reverse proxy
├── next.config.ts                 ← Minimal Next.js config
├── tailwind.config.ts
├── tsconfig.json / package.json / bun.d.ts / eslint.config.mjs / postcss.config.mjs
├── openapi-gen.config.json        ← OpenAPI spec generation config for the internal REST API
│
├── docs/                          ← Design notes and implementation strategy docs, including the Primordia CLI/Core extraction sketch
├── changelog/                     ← One .md file per change: YYYY-MM-DD-HH-MM-SS Description.md
│   └── *.md                       ← Filename = short description; body = full what+why detail
├── scripts/                       ← Process supervisor, reverse proxy source, install script, worker processes — see .claude/rules/filemap-scripts.md
├── lib/                           ← Shared utilities, DB adapter, auth helpers, PID/lockfile helpers, scheduled-jobs boundary + lib/jobs implementations — see .claude/rules/filemap-lib.md
│                                    Also: lib/CLAUDE.md covers the git config key-value store pattern
├── components/                    ← Shared React components — see .claude/rules/filemap-app-pages.md
└── app/                           ← Next.js App Router pages and API routes
    ├── api/thread/                ← Thread and agent-run endpoints — see app/api/thread/CLAUDE.md
    ├── api/server/                ← Preview/process management endpoints — see .claude/rules/filemap-app-api.md
    ├── api/auth/                  ← Auth endpoints + RBAC — see app/api/auth/CLAUDE.md
    ├── api/admin/                 ← Admin-only endpoints — see .claude/rules/filemap-app-api.md
    └── (pages)                    ← UI pages — see .claude/rules/filemap-app-pages.md
```

---

## Environment Variables

For normal installs, `scripts/install.sh` creates `.env.local` automatically. For manual source checkouts, copy `.env.example` to `.env.local` and set the values you need.

| Variable | Required | Description |
|---|---|---|
| `REVERSE_PROXY_PORT` | Installer-managed | Port the reverse proxy listens on (e.g. `3000` locally or `8000` on hosted installs). Blue/green accepts and rollbacks use zero-downtime cutover via the proxy. Set manually only for source checkouts or custom deployments. |
| `PRIMORDIA_DIR` | No | Root directory of the Primordia installation. Set by the installer in the systemd service — not intended for manual configuration. Fresh installs: repo root. Worktree installs: two levels above the worktree (`$PRIMORDIA_DIR/worktrees/{branch}`). |
| `NEXT_BASE_PATH` | No | URL sub-path prefix (e.g. `/primordia`) for hosting the app at a non-root path. Leave unset to serve from `/` (default). Sets both Next.js `basePath` config and `NEXT_PUBLIC_BASE_PATH` for client-side `fetch()` calls. Also set automatically on preview dev servers to `/preview/{sessionId}` when `REVERSE_PROXY_PORT` is active. |

---

## Setup Checklist (One-Time)

Install Primordia on a local machine, VM, or exe.dev server with the one-line installer:

```bash
curl -fsSL https://primordia.exe.xyz/install.sh | bash -s
```

The installer clones Primordia, installs the pinned runtime and dependencies when needed, writes `.env.local`, starts the `primordia` service, and prints the URL to open.

For manual development from a source checkout, copy `.env.example` to `.env.local`, set `REVERSE_PROXY_PORT`, then run `mise install && bun install && bun run dev`.

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
10. **Server-first page data.** Initial page content should be loaded in Server Components whenever possible, then passed into client components as props. Avoid `useEffect(...fetch...)` for data required to render the first meaningful page view; reserve client fetches for mutations, explicit refreshes, SSE/polling/live previews, and intentionally lazy details. See `docs/instant-page-data-loading-strategy.md`.
11. **Import paths.** Avoid parent-directory imports that start with `../`. Use the `@/` alias for parent or cross-directory imports instead. Same-directory `./` imports are OK.
12. **Add exactly one changelog file per pull request.** After every set of changes, create a single new file in `changelog/` named `YYYY-MM-DD-HH-MM-SS Description of change.md` (UTC time, e.g. `2026-03-16-21-00-00 Fix login bug.md`). The filename is the short description; the file body is the full "what changed + why" detail in markdown. One PR = one changelog entry, even if the PR went through multiple iterations.
13. **CLI boundaries.** CLI scripts must never import `app/api/**/route.ts` modules directly. When a CLI command and an API route need the same behavior, extract that behavior into `lib/*` and have both callers import the shared library module.

---

## Current Features

| Feature | Status | Notes |
|---|---|---|
| Thread mode | ✅ Live | "Propose a change" in the hamburger opens a draggable/dockable floating dialog; `/thread` is the standalone thread creation page; before any thread worktree is deleted, its `.primordia-session.ndjson` log is saved as a gzip archive under `PRIMORDIA_DIR/past-sessions` when present |
| Local thread pipeline | ✅ Live | git worktree → Claude Agent SDK → local preview → accept/reject |
| Thread follow-up requests | ✅ Live | Chain multiple Claude passes on the same branch; form appears when the thread is ready; draft text persists across refreshes per thread |
| Explicit preview target selection | ✅ Live | Agents set the thread preview panel route by running `bun run set-preview-url /route` after app file edits and before validation/changelog work; the thread page renders the preview as soon as that structured `preview_path` event appears instead of waiting for the agent run to finish or relying on ambiguous final-message path parsing |
| File attachments in threads | ✅ Live | Attach images/files to initial and follow-up requests; files are copied into `worktree/attachments/` so Claude can read and use them; the page picker highlights nearest `data-component` targets in blue and nearest `data-id` targets in green, includes both names/selectors in generated element markdown, and key preview/follow-up controls carry explicit picker names via `data-id` |
| Thread draft persistence | ✅ Live | Initial request drafts in `/thread` and the floating Propose-a-change dialog share a local timestamped draft; follow-up drafts are saved per thread until submitted; drafts older than one year are garbage-collected |
| Multiple agent harnesses | ✅ Live | Thread form lets users choose harness (claude-code, pi, or codex) and model; preferences persisted per-user in DB; all harnesses receive the Primordia progress-monitor prompt and can update the session progress panel through `bun run progress plan insert|replace` and `bun run progress step done|failed`; progress starts with `Make a plan`, supports weighted steps, one active current step, failure/repair insertion, incomplete-list carryover into follow-up turns, and late `plan insert` from the virtual Wrap-up step; text/reasoning/tool-call details are grouped under the active step; completed agent sections keep rendering the progress panel for success/error/timeout/abort states, including early termination before tool calls, while final summaries remain visible outside the progress accordion; legacy TodoWrite/Pi task events still render as a fallback for older session logs; Codex exec JSON is normalized into structured tool/reasoning session events |
| Upstream changes indicator | ✅ Live | Thread page shows how many commits the resolved parent branch is ahead of the session branch, with an "Apply Updates" button that merges prod updates, records updated branch-parent trailers on the merge commit, snapshots the prod DB via SQLite `VACUUM INTO`, and hot-swaps the preview server DB cleanly; session parentage is stored in branch-marker commit trailers and requires an actual marker commit (missing parentage is not inferred) |
| Git diff summary | ✅ Live | Thread page shows a collapsible "Files changed" section (file names + +/- LOC), keeps it visible while agents are running with a stale-state warning, and offers a manual reload button for fresh file lists |
| Thread from existing branch | ✅ Live | Threads page shows "+ thread" next to branches with no active thread; thread users can attach the full AI preview pipeline to any pre-existing local branch; the current branch is shown with its descendant tree even when it is outside production ancestry |
| Upstream updates (/admin/updates) | ✅ Live | Admin-only; pull upstream Primordia changes from configured update sources; auto-scheduled fetches run through the Primordia Core jobs boundary |
| One-line installer | ✅ Live | `curl -fsSL https://primordia.exe.xyz/install.sh \| bash -s` installs Primordia on a local machine, VM, or exe.dev server |
| Dark theme | ✅ Live | Default dark UI with Tailwind |
| Passkey authentication | ✅ Live | WebAuthn passkeys via /login; sessions stored in SQLite |
| Cross-device QR sign-in | ✅ Live | Laptop shows QR code; authenticated phone scans it and approves; laptop gets a session |
| Credentials management | ✅ Live | Account Settings includes unified Billing sources (`/settings`), Presets (`/settings/presets`), and API Keys (`/settings/api-keys`) for creating/revoking expiring CLI or web API-key values that wrap the browser-held AES JWK; users can connect Claude.ai credentials and ChatGPT subscription OAuth credentials, store API keys encrypted, and define thread presets that bundle billing source + harness + model; thread ChatGPT auth failures render an inline re-login prompt that can reconnect the subscription without leaving the thread page |
| Credentials management | ✅ Live | Account Settings includes unified Billing sources (`/settings`), Presets (`/settings/presets`), and API Keys (`/settings/api-keys`) for creating/revoking expiring CLI or web API-key values that wrap the browser-held AES JWK; revoked API keys keep a non-secret history row with the encrypted AES wrapper secret cleared so callers can distinguish revoked vs unknown keys; users can connect Claude.ai credentials and ChatGPT subscription OAuth credentials, store API keys encrypted, and define thread presets that bundle billing source + harness + model; built-in Pi presets include GPT-5.6 Luna and GPT-5.6 Terra; Pi/Codex workers persist rotated ChatGPT access/refresh tokens back into encrypted storage using the selected user's AES key; thread ChatGPT auth failures render an inline re-login prompt that can reconnect the subscription without leaving the session page |
| RBAC (roles) | ✅ Live | Simple role system: `admin` (auto-granted to first user) and thread access (`can_evolve`); /admin page lets admin grant/revoke roles; protected pages show informative 403 instead of redirecting |
| Dependency security (/admin/dependencies-security) | ✅ Live | Admin-only; shows `bun audit` output, daily checks for high/critical vulnerabilities, notification bell alerts, and one-click threads to update vulnerable packages |
| Server logs (/admin/logs) | ✅ Live | Admin-only; live tail of production server stdout/stderr via SSE from the production worktree's `.primordia-next-server.log` |
| Process status CLI | ✅ Live | `bun run primordia status` remains top-level and lists the git-configured production branch, service-supervisor/reverse-proxy/scheduled-jobs status, git worktrees sorted by assigned port, active Next.js server process state/env/PID/child count, and active agent worker PIDs without querying the reverse proxy; JSON output exposes `productionBranch`, `services`, `reverseProxy`, `servers`, and `agents` arrays; supports table and `--json` output. |
| Thread CLI commands | ✅ Live | Agentic coding commands live under `bun run primordia thread`: `thread create "request"` creates a thread and returns the new worktree path for easy `cd`; `thread followup "request"`, `thread update`, `thread accept`, and `thread reject` operate on the current thread resolved from cwd, without an explicit worktree override. `bun run primordia preferences get|set` reads and updates per-user thread defaults (preferred preset, fallback harness/model, and caveman mode/intensity). CLI callers select users/presets with flags and must pass a revokable `PRIMORDIA_CLI_KEY` from `/settings/api-keys` for create/followup/accept commands; the CLI resolves that key to the worker-only AES env internally; billing source, harness, model, thread permission checks, and accept/reject behavior live in `lib/threads.ts` (`createThread`/`followupThread` accept preset IDs and resolve preset details internally; `manageThread` is shared by the API route and CLI) so the CLI never imports API route modules directly. |
| Thread server CLI commands | ✅ Live | Current-thread process commands live under `bun run primordia server`: `server start [--dev|--prod] [--json]`, `server stop [--json]`, `server restart [--dev|--prod] [--json]`, `server logs [--follow] [--json]`, `server publish [--json]`, and `server copydb [--json]`; all resolve the current thread from cwd and append/read `.primordia-next-server.log` through the shared process-manager layer. The thread Web Preview logs stream over SSE from `/api/server/logs`, and restart controls/reverse proxy lazy preview/prod spawning use this process-manager layer instead of reverse-proxy-owned app processes; the proxy refuses to stop preview entries that resolve to current production, rechecks stale preview entries so `/preview/{sessionId}` can lazily restart a down dev server, lazily starts production if it is accessed while down, and also health-checks production in the background so it restarts and sends Server Health Alert web pushes even without incoming traffic. Process-manager server logs include lifecycle annotations for graceful stop requests, forced kills, launches, and command exit status. CLI `--follow` log commands exit when stdin/stdout/stderr closes so Core API clients and killed app servers do not orphan long-lived follower processes. Linux OOM priority is explicit: systemd starts the supervisor at `oom_score_adj=-1000`, then child processes raise themselves so the reverse proxy/scheduled jobs stay protected, production is preferred over agents, agents are preferred over dev servers, and newer dev servers are easiest to kill. Scheduled job commands live under `bun run primordia jobs`: `jobs run`, `jobs run-one <job>`, `jobs restart`, `jobs logs [-n count] [-f]`, and `jobs schedule list|get|set`; intervals are stored in git config under `primordia.jobs.*IntervalMs`, and the systemd-facing Primordia service-supervisor keeps the dedicated jobs daemon alive alongside the reverse proxy. `bun run primordia systemd service-supervisor restart`, `bun run primordia reverse-proxy restart`, and `bun run primordia reverse-proxy logs [-n count] [-f]` manage the supervisor and reverse proxy with clearer boundaries. |
| Proxy logs (/admin/proxy-logs) | ✅ Live | Admin-only; live tail of `journalctl -u primordia-proxy -f -n 100` via SSE |
| Deep rollback (/admin/rollback) | ✅ Live | Admin-only; lists all previous production slots from primordia.productionHistory in git config; "Roll back" button for each target; zero-downtime cutover via reverse proxy |
| Server health (/admin/server-health) | ✅ Live | Admin-only; disk and memory usage with visual bars; live Primordia process RSS/OOM-score table with Core API command totals; recent kernel OOM-kill history from journalctl/dmesg; oldest non-prod worktree cleanup; scheduled diagnostics capture writes `leak-diagnostics/latest.md`, separates CPU usage and memory leak issues, requires about one hour of sustained CPU pressure before CPU diagnostics are captured, alerts admins per active issue, and lets admins delete/dismiss diagnostics or launch an investigate/fix thread from Server Health |
| Git mirror (/admin/git-mirror) | ✅ Live | Admin-only; every production deploy auto-pushes to `mirror` remote if it exists |
| Instance identity & social graph | ✅ Live | Each instance has a fixed UUID v7, editable name+description; serves `/.well-known/primordia.json` with self+peers+edges; `/api/instance/register` lets child instances POST to register; instances installed from another Primordia persist/infer that parent URL and retry registration on first server request; admin panel at `/admin/instance` |
| User event tracking | ✅ Live | `events` table in SQLite; `POST /api/events` (open, no auth); `GET /api/events` (admin); browser helper in `lib/events-client.ts`; admin viewer at `/admin/events` |
| Web push notifications | ✅ Live | SQLite-backed VAPID keys + per-user push subscriptions + category preferences; `/api/web-push/*` endpoints; service worker at `/primordia-sw.js`; `/settings/notifications` lets thread users subscribe to Security Vulnerabilities, Primordia Updates, and Server Health Alerts; scheduled dependency audits/update fetches/leak diagnostics send actionable category notifications; developer test page at `/test-pages/web-push-test` can simulate categories |
| Read-only git HTTP | ✅ Live | Clone/fetch via `git clone http[s]://<host>/api/git`; proxied through `git http-backend`; push permanently blocked (403) |
| OpenAPI spec | ✅ Live | Served at `/api/openapi`; generated on first request from `openapi-gen.config.json` |

## Changelog

> **Changelog entries are stored exclusively in `changelog/`** — never in this file.
> Each file is named `YYYY-MM-DD-HH-MM-SS Description.md`; the filename is the short description and the body has the full what+why detail.
> **One PR = one changelog entry.** Do not create multiple changelog files for a single pull request — consolidate all changes into one entry.
> The `/changelog` page reads `changelog/` directly at runtime. Having each entry as a separate timestamped file prevents merge conflicts.
> Do **not** add changelog bullets here.
