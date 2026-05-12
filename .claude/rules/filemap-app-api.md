---
paths:
  - "app/api/**"
---

## File Map: app/api/

```
app/api/
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
├── secrets/[type]/route.ts        ← Unified GET/POST/DELETE for all user secrets (ANTHROPIC_API_KEY, OPENROUTER_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, CLAUDE_CODE_CREDENTIALS_JSON, CHATGPT_SUBSCRIPTION_OAUTH); stored in encrypted_credentials by auth_source
├── credential-encryption/public-key/route.ts ← GET server's ephemeral RSA-OAEP public key as JWK for hybrid credential transmission
├── oauth/chatgpt-subscription/route.ts ← POST starts/completes ChatGPT device-code OAuth flow for subscription credentials
├── admin/
│   ├── permissions/route.ts   ← POST grant/revoke grantable roles (can_evolve); admin only
│   ├── logs/route.ts          ← GET SSE stream of production server logs; admin only
│   ├── proxy-logs/route.ts    ← GET SSE stream of journalctl -u primordia-proxy; admin only
│   ├── rollback/route.ts      ← GET/POST previous prod slots from primordia.productionHistory; admin only
│   ├── server-health/route.ts ← GET disk/memory usage; POST delete oldest worktree; admin only
│   ├── git-mirror/route.ts    ← GET/POST/DELETE manage "mirror" git remote for push mirroring; admin only
│   ├── proxy-settings/route.ts ← GET/PATCH reverse proxy configuration from git config; admin only
│   ├── updates/route.ts       ← POST manage upstream update sources and create merge sessions; admin only
│   └── updates/has-updates/route.ts ← GET lightweight check: does any update source have new commits? Returns { hasUpdates: boolean }; admin only
├── instance/
│   ├── config/route.ts        ← GET/PATCH instance metadata (uuid7, name, description, URLs)
│   ├── primordia-json/route.ts ← GET instance identity + social graph at /.well-known/primordia.json
│   └── register/route.ts      ← POST allows child Primordia instances to register as graph nodes
└── events/route.ts            ← POST append event (open, no auth required); GET query events (admin only)
```
