# Add GitHub sync button to header

## What changed

- **New cloud-upload icon button** added to the top-right header in `ChatInterface.tsx`, to the left of the existing pencil (Evolve) button. It turns green on hover.
- **Confirmation dialog** (`GitSyncDialog` component, inline in `ChatInterface.tsx`) appears when the button is clicked. It explains the operation, streams live git output as the sync runs, and shows a success/error status when done. The user can cancel before starting, or close after completion.
- **New API route** `app/api/git-sync/route.ts` (POST) performs the sync:
  1. Determines the current branch via `git rev-parse --abbrev-ref HEAD`.
  2. Builds an authenticated HTTPS remote URL using `GITHUB_TOKEN` as the username (password blank), so no separate credential helper is needed.
  3. Checks with `git ls-remote` whether the branch already exists on the remote.
  4. If the remote branch exists: runs `git pull --no-rebase` (merge, not rebase).
  5. If the pull exits with conflicts, detects conflicted files via `git status --porcelain` and launches Claude Code (`@anthropic-ai/claude-agent-sdk` `query()`) to resolve them automatically, streaming its progress back to the UI.
  6. Runs `git push` (with `--set-upstream` if the remote branch was new).
  7. All git and Claude Code output is streamed to the browser via SSE (`text/event-stream`).

## Why

Users working on a local dev instance (e.g. deployed to an exe.dev server via `bun run deploy-to-exe.dev`) had no way to push their changes back to GitHub or pull others' work without SSH-ing into the server. This button gives them a one-click way to synchronise the current branch without needing git knowledge.
