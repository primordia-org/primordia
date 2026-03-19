# Suppress GITHUB_TOKEN warning in local dev

## What changed
`app/api/check-keys/route.ts` now skips the `GITHUB_TOKEN` and `GITHUB_REPO` checks when `NODE_ENV === "development"`.

## Why
In local development the evolve pipeline runs entirely via git worktrees and the `@anthropic-ai/claude-agent-sdk` — it never touches the GitHub API. Showing a "missing GITHUB_TOKEN" warning in that context is misleading and unnecessary noise for local developers who only need `ANTHROPIC_API_KEY` to use the app locally.
