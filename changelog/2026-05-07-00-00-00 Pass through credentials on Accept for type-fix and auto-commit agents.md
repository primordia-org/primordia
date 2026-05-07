# Pass through credentials on Accept for type-fix and auto-commit agents

## What changed

When a user clicks Accept on a session, the client now encrypts and sends credentials (Claude Code `credentials.json`) or an Anthropic API key alongside the accept request. The server decrypts them and forwards them to any agent sessions spawned during the accept pipeline:

- **Type-fix agent** (`fixing-types` status): triggered when `install.sh` exits with code 2 (TypeScript errors). Previously ran with no credentials, falling back to the exe.dev LLM gateway even if the user had stored credentials.
- **Auto-commit agent** (`auto_commit` section): triggered by Gate 2 when the worktree has uncommitted changes. Same issue — ran without credentials.

### Changes

- `app/evolve/session/[id]/EvolveSessionView.tsx` — `handleAccept` now encrypts stored credentials (or API key as fallback) and includes them in the JSON body sent to `POST /api/evolve/manage`.
- `app/api/evolve/manage/route.ts` — `EvolveManageBody` gains optional `encryptedCredentials` and `encryptedApiKey` fields. The POST handler decrypts them and passes them through to both `runAcceptAsync` (for the type-fix agent) and the Gate 2 `commitSession` (for the auto-commit agent).

## Why

The type-fix and auto-commit passes are Claude Code agent sessions. Without credentials they fall back to the default exe.dev LLM gateway, which may not be the user's intended auth source — and may fail entirely if the gateway requires a subscription the user doesn't have. Passing credentials through ensures these automated repair passes use the same auth as the rest of the session.
