---
paths:
  - "app/api/**"
---

## File Map: app/api/

```
app/api/
├── changelog/route.ts              ← GET ?filename=...: returns raw markdown body of one changelog file (lazy-load)
├── git/[...path]/route.ts          ← GET/POST git http-backend proxy (read-only clone/fetch); push blocked with 403
├── markdown-stream/route.ts        ← Streams markdown sample character-by-character via SSE for test pages
├── openapi/route.ts                ← Serves OpenAPI spec, generating on first request if not on disk
├── prune-branches/route.ts         ← Returns 410 Gone (superseded endpoint)
├── rollback/route.ts               ← Returns 410 Gone (superseded by /api/admin/rollback)
├── threads/parent-source/route.ts  ← PATCH current user's Threads page parent source (`git-config` or `branch-marker`)
├── auth/                           ← Session, logout, exe.dev SSO, passkey, and cross-device QR auth endpoints
│   ├── session/route.ts            ← GET current session user
│   ├── logout/route.ts             ← POST clear session
│   ├── exe-dev/route.ts            ← GET exe.dev SSO login: reads injected headers, creates/finds user + session
│   ├── passkey/...                 ← WebAuthn registration/login start+finish routes
│   └── cross-device/...            ← Pull/push QR sign-in token creation, polling, approval, and SVG QR generation
├── claude-auth/                    ← Temporary Claude subscription OAuth capture used by settings/test pages
│   ├── start/route.ts              ← POST spawn `claude auth login` helper and return OAuth URL/session id
│   ├── complete/route.ts           ← POST submit authorization code and return credentials JSON when helper exits
│   ├── cancel/route.ts             ← POST cancel helper process and clean up temp config dir
│   └── logs/route.ts               ← GET SSE stream of helper stdout/stderr/system log lines
├── thread/                         ← Thread and agent-run endpoints
│   ├── route.ts                    ← POST start thread (requires can_evolve permission), GET thread status
│   ├── stream/route.ts             ← GET SSE stream of live thread progress
│   ├── manage/route.ts             ← POST accept/reject a ready thread
│   ├── followup/route.ts           ← POST submit a follow-up request on an existing ready thread
│   ├── abort/route.ts              ← POST abort the running agent instance; transitions thread to ready
│   ├── upstream-sync/route.ts      ← POST merge parent branch into thread worktree, run bun install, and hot-swap preview DB snapshot
│   ├── from-branch/route.ts        ← POST start a thread on an existing local branch
│   ├── diff/route.ts               ← GET raw unified diff for a single file in a thread branch vs its parent
│   ├── diff-summary/route.ts       ← GET per-file diff summary for all changed files in a thread
│   ├── models/route.ts             ← GET available model options grouped by agent harness from generated registry data
│   ├── presets/route.ts            ← GET built-in/custom thread presets with availability for the current user
│   ├── sessions/route.ts           ← GET persisted threads for session list/history UIs
│   ├── reset-stuck/route.ts        ← POST force-reset threads stuck in 'accepting'/'fixing-types' back to 'ready'
│   └── attachment/[threadId]/route.ts ← GET serve user-uploaded attachment files from a thread worktree
├── server/                         ← Preview/process management endpoints
│   ├── kill-restart/route.ts       ← POST kill dev server process + restart it in the worktree
│   ├── logs/route.ts               ← GET SSE stream of a thread preview server log
│   └── hotswap-db/route.ts         ← Internal loopback-only endpoint used by Apply Updates to close/reopen preview SQLite DB
├── secrets/route.ts                ← Bulk GET/POST/DELETE for encrypted user secrets keyed by auth source
├── secrets/[source]/route.ts       ← Per-source GET/POST/DELETE for encrypted credentials/API keys
├── credential-encryption/public-key/route.ts ← GET server's ephemeral RSA-OAEP public key as JWK for hybrid credential transmission
├── oauth/chatgpt-subscription/route.ts ← POST starts/completes ChatGPT device-code OAuth flow for subscription credentials
├── settings/presets/route.ts       ← GET/POST/PATCH/DELETE current user's saved evolve presets
├── web-push/                       ← VAPID public key, subscription, category preference, and test notification routes
│   ├── public-key/route.ts         ← GET VAPID public key for browser PushManager subscription
│   ├── subscriptions/route.ts      ← GET/POST/DELETE current user's web push subscription
│   ├── categories/route.ts         ← GET/PATCH notification category preferences
│   └── test/route.ts               ← POST send developer/test category notifications
├── admin/                          ← Admin-only operational endpoints
│   ├── permissions/route.ts        ← POST grant/revoke grantable roles (can_evolve)
│   ├── logs/route.ts               ← GET SSE stream of production server logs
│   ├── proxy-logs/route.ts         ← GET SSE stream of journalctl -u primordia-proxy
│   ├── rollback/route.ts           ← GET/POST previous prod slots from primordia.productionHistory
│   ├── server-health/route.ts      ← GET disk/memory usage; POST delete oldest worktree
│   ├── git-mirror/route.ts         ← GET/POST/DELETE manage "mirror" git remote for push mirroring
│   ├── proxy-settings/route.ts     ← GET/PATCH reverse proxy configuration from git config
│   ├── updates/route.ts            ← POST manage upstream update sources and create merge threads
│   ├── updates/has-updates/route.ts ← GET lightweight update-source notification check
│   ├── dependencies-security/route.ts ← GET/POST run bun audit and create threads for vulnerable dependencies
│   └── dependencies-security/has-alert/route.ts ← GET lightweight high/critical bun audit notification check
├── instance/                       ← Instance identity, manifest, and parent/child graph registration endpoints
└── events/route.ts                 ← POST append event (open, no auth required); GET query events (admin only)
```
