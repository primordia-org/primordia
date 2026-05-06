---
paths:
  - "lib/**"
---

## File Map: lib/

```
lib/
├── system-prompt.ts           ← Orphaned: was chat assistant system prompt builder; reads CLAUDE.md + changelog; no longer imported anywhere
├── auth.ts                    ← Session helpers: createSession, getSessionUser, isAdmin (admin role check), hasEvolvePermission (admin or can_evolve role)
├── base-path.ts               ← basePath constant + withBasePath() helper; used by all client-side fetch() calls to prefix API routes when NEXT_BASE_PATH is set
├── hooks.ts                   ← Shared React hooks: useSessionUser (fetches session on mount, provides logout)
├── evolve-sessions.ts         ← Shared session state + business logic for local evolve; persists to SQLite
├── page-title.ts              ← Utility: buildPageTitle() — formats <title> with branch suffix in development mode; clean title in production
├── sounds.ts                  ← Synthesised UI sound effects via Web Audio API (no audio files — all procedural); useSounds() hook with send/receive/error/accept/reject/click/etc.
├── llm-client.ts              ← Creates Anthropic client: gateway (default) or direct API with user-supplied key
├── llm-encryption.ts          ← Server-side RSA-OAEP keypair (ephemeral, per process); getPublicKeyJwk() + decryptApiKey()
├── api-key-client.ts          ← Client-side helpers: getStoredApiKey/setStoredApiKey (localStorage) + encryptStoredApiKey() (RSA-OAEP)
├── agent-config.ts            ← Definitions for supported coding agent harnesses and model options; imports MODEL_OPTIONS from lib/models.generated.json
├── models.generated.json      ← Hard-coded model list (id, label, pricing) for all harnesses; regenerate with `bun run regenerate:model-registry`
├── auto-canonical.ts          ← On first request, derives and persists canonical URL from request origin if not already set
├── credentials-client.ts      ← Client-side AES-256-GCM encryption helpers for storing Claude Code credentials.json
├── cross-device-creds.ts      ← ECDH P-256 helpers for credential transfer in pull and push cross-device sign-in flows
├── pi-model-registry.server.ts ← Builds model option list at runtime from pi ModelRegistry; no longer imported by app code (kept as reference / used by regenerate script logic)
├── public-origin.ts           ← Utility for deriving public-facing origin from request, respecting x-forwarded-* headers
├── register-with-parent.ts    ← Posts instance identity to parent's registration endpoint and returns status string
├── session-events.ts          ← Structured event types for session progress logs stored as NDJSON in worktree
├── smart-preview-url.ts       ← Infers the most relevant preview page path from LLM text output in session events
├── update-source-scheduler.ts ← Background scheduler that automatically fetches update sources per frequency settings
├── update-sources.ts          ← Manages git-based update sources via git config remote.{id}.* namespace
├── user-prefs.ts              ← Server-side helpers for reading per-user preferences (harness, model, caveman) from database
├── uuid7.ts                   ← UUID v7 helper (delegates to the `uuid` npm package)
├── validate-canonical-url.ts  ← Validation for Canonical URL field (HTTPS, non-localhost)
├── auth-providers/            ← Auth provider system (no registry — auto-discovered by login page)
│   ├── types.ts               ← AuthPlugin, AuthPluginServerContext, InstalledPlugin, AuthTabProps
│   ├── passkey/index.ts       ← default export: passkeyPlugin descriptor
│   ├── exe-dev/index.ts       ← default export: exeDevPlugin (reads X-ExeDev-Email header)
│   └── cross-device/index.ts  ← default export: crossDevicePlugin
└── db/
    ├── index.ts               ← Factory: getDb() → SQLite (always)
    ├── types.ts               ← Shared DB types: User, Passkey, Challenge, Session, CrossDeviceToken, EvolveSession, Role; DbAdapter includes role methods
    └── sqlite.ts              ← bun:sqlite adapter (includes evolve_sessions, roles, user_roles tables; seeds built-in roles on boot)
```
