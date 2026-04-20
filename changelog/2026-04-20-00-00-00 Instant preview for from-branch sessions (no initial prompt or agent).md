# Instant preview for from-branch sessions (no initial prompt or agent)

## What changed

The "create a session from an existing branch" flow on `/branches` no longer requires an initial prompt and no longer launches a Claude agent on session creation.

### UI (`app/branches/CreateSessionFromBranchButton.tsx`)
- Removed the inline form / text input that previously asked "What do you want to do?".
- Clicking `+ session` now immediately POSTs to `/api/evolve/from-branch` and redirects to the session view — no intermediate prompt step.

### API (`app/api/evolve/from-branch/route.ts`)
- Removed `request` and `encryptedApiKey` from the request body.
- Session is created with an empty initial request and `skipAgentLaunch: true`.

### Core (`lib/evolve-sessions.ts`)
- Added `skipAgentLaunch?: boolean` option to `startLocalEvolve`.
- When set, all setup steps (worktree creation, `bun install`, DB copy, `.env.local` symlink) still run, but instead of spawning the Claude worker the function writes a `result success` event and returns.
- This moves the session directly to `ready` status, making the preview immediately accessible.

### Session view (`app/evolve/session/[id]/EvolveSessionView.tsx`)
- The "Your request" card is now hidden when `initialRequest` is empty, avoiding a blank card for instant-preview sessions.

## Why

When reviewing an existing branch (e.g. an external contributor's PR), the code is already written and we just want to preview it. Forcing an initial prompt and waiting for an agent run was unnecessary friction. With this change you can:

1. Click `+ session` on any branch.
2. Wait for setup (bun install, DB copy, etc.).
3. Preview the branch immediately in the embedded preview pane.
4. Accept if no changes are needed, or submit a follow-up request to have Claude make adjustments.
