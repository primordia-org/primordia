---
paths:
  - "lib/**"
---

## File Map: lib/

```
lib/
├── system-prompt.ts             ← Orphaned: was chat assistant system prompt builder; reads CLAUDE.md + changelog; no longer imported anywhere
├── auth.ts                      ← Session helpers: createSession, getSessionUser, isAdmin, hasEvolvePermission
├── base-path.ts                 ← basePath constant + withBasePath() helper for client-side fetch() prefixes
├── branch-graph-layout.ts       ← Branch graph layout utilities used by /branches and export scripts
├── branch-parent.ts             ← Branch-marker commit helpers for persistent branch parentage with legacy git-config fallback
├── git-runtime.ts               ← Git runtime metadata helpers for worktree enumeration, branch ports, and production branch config
├── hooks.ts                     ← Shared React hooks: useSessionUser (fetches session on mount, provides logout)
├── evolve-sessions.ts           ← Shared local evolve session state, worktree orchestration, workers, previews, accept/reject logic, SQLite persistence
├── page-title.ts                ← buildPageTitle(): formats <title> with branch suffix in development mode
├── sounds.ts                    ← Procedural Web Audio UI sound effects and useSounds() hook
├── llm-client.ts                ← Creates Anthropic client: exe.dev gateway or direct API key
├── llm-encryption.ts            ← Server-side RSA-OAEP keypair; public-key export + transmitted secret decrypt helpers
├── secrets-client.ts            ← Unified browser secret storage and hybrid encryption helpers for all SecretType values
├── api-key-client.ts            ← Compatibility shim re-exporting API-key helpers from secrets-client
├── credentials-client.ts        ← Compatibility shim re-exporting Claude credentials helpers from secrets-client
├── preset-credentials-client.ts ← Client helpers for encrypting/decrypting preset-selected credential sources
├── use-decrypt-effect.ts        ← React hook helper for decrypting encrypted settings data after hydration
├── agent-config.ts              ← Supported harness/model definitions backed by lib/models.generated.json
├── models.generated.json        ← Generated model list (id, label, pricing); regenerate with `bun run regenerate:model-registry`
├── pi-custom-models.ts          ← Writes Primordia-specific pi models.json overlay for newly added provider models
├── pi-model-registry.server.ts  ← Builds model option list from pi ModelRegistry; kept as reference/regeneration support
├── preset-options.ts            ← Model/preset option shaping for evolve request/settings UIs
├── preset-availability.ts       ← Computes whether billing sources/secrets make a preset usable for the current user
├── presets.ts                   ← Built-in evolve preset definitions and shared preset/auth-source types
├── auto-canonical.ts            ← Derives and persists canonical URL from request origin on first request
├── claude-temp-auth.ts          ← Temporary `claude auth login` process/session manager for Claude subscription credential capture
├── cross-device-creds.ts        ← ECDH P-256 helpers for credential transfer in cross-device sign-in flows
├── public-origin.ts             ← Derives public-facing origin from request, respecting x-forwarded-* headers
├── register-with-parent.ts      ← Posts instance identity to parent's registration endpoint and returns status text
├── progress-monitor.ts          ← Shared reducer, validation, summary, and tick-mark math for `progress_*` session events
├── progress-prompt.ts           ← Shared harness prompt explaining `bun run progress` usage to agents
├── session-events.ts            ← Structured event types for session progress logs stored as NDJSON in worktrees
├── smart-preview-url.ts         ← Infers the most relevant preview page path from agent text/session events
├── update-source-scheduler.ts   ← Background scheduler that fetches update sources per configured frequency
├── dependency-audit.ts          ← Runs `bun audit`, parses findings, stores severe-audit notification state in git config
├── dependency-audit-scheduler.ts ← Daily high/critical dependency audit scheduler and admin notification updater
├── update-sources.ts            ← Git-based update-source management via git config remote.{id}.* namespace
├── user-prefs.ts                ← Server-side helpers for per-user evolve preferences (harness, model, caveman)
├── events-client.ts             ← trackEvent()/appendEvent() helper that POSTs to /api/events
├── utc-to-local-time.ts         ← UTC timestamp to localized display string helper
├── uuid7.ts                     ← UUID v7 helper (delegates to the `uuid` npm package)
├── validate-canonical-url.ts    ← Validation for Canonical URL field (HTTPS, non-localhost)
├── web-push.ts                  ← VAPID key, subscription, category preference, and send helpers backed by SQLite
├── auth-providers/              ← Auth provider descriptors and explicit enabled-provider registry
│   ├── registry.ts              ← ENABLED_PROVIDERS order/gate used by login page and middleware-safe checks
│   ├── types.ts                 ← AuthPlugin, AuthPluginServerContext, InstalledPlugin, AuthTabProps, AuthPluginMap
│   ├── passkey/index.ts         ← default export: passkeyPlugin descriptor
│   ├── exe-dev/index.ts         ← default export: exeDevPlugin (reads X-ExeDev-Email header)
│   └── cross-device/index.ts    ← default export: crossDevicePlugin
└── db/
    ├── index.ts                 ← Factory: getDb() → SQLite; includes SQLite hotswap reset lock
    ├── types.ts                 ← Shared DB types and DbAdapter interface for users, sessions, roles, secrets, events, presets, web push
    └── sqlite.ts                ← bun:sqlite adapter; schema migrations/seeding and concrete DbAdapter methods
```

## Git Config as Key-Value Store

Primordia uses `.git/config` as a lightweight key-value store for **non-sensitive runtime state** (no secrets — use `.env.local` or encrypted DB storage; no user data — use SQLite). The reverse proxy reads it directly without starting Next.js.

### Established namespaces

| Namespace | Example key | What it stores |
|---|---|---|
| `primordia.*` | `primordia.productionBranch` | App-wide settings; proxy reads these live via `fs.watch` on `.git/config` |
| `primordia.*` | `primordia.productionHistory` | Multi-value list of previous production branch names (written with `--add`) |
| `primordia.*` | `primordia.previewInactivityMin` | Proxy tuning knobs (see `app/api/admin/proxy-settings/route.ts`) |
| `branch.{name}.*` | `branch.main.port` | Per-branch ephemeral port; proxy discovers preview servers this way |
| `branch.{name}.*` | `branch.feature-x.parent` | Legacy parent branch metadata; still written while branch-marker commit trailer tracking is user-toggleable |
| `remote.{name}.*` | `remote.primordia-official.updateSource` | Update source metadata extending the standard git remote section |

### Output format of `--get-regexp`

Each line is `<key><space><value>` with no `=`. Git **lowercases the section and field names** but **preserves the subsection name's case**. Always split on the first space. Use `[^.]+` (not `.*`) in regexes to avoid greedy matches across dots.

### Code reference

See `lib/update-sources.ts` for the subsection pattern. See `lib/evolve-sessions.ts` (`getOrAssignBranchPort`) for a simple single-key read/write example.
