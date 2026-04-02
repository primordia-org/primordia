# Update README to reflect current architecture

## What changed

Rewrote `README.md` from scratch. The old README described a completely different, earlier design that was never shipped:

- **Old**: GitHub Actions CI pipeline + Vercel hosting + GitHub Issues/PRs as the evolve mechanism
- **New**: Local git worktrees + `@anthropic-ai/claude-agent-sdk` + exe.dev hosting + SQLite auth

Specific changes:

- **How It Works** section now describes the actual local worktree pipeline (branch → Claude Agent SDK → preview dev server → accept/reject), not GitHub Actions
- **Tech Stack** table updated: removed Vercel/GitHub Actions, added `bun:sqlite`, `claude-agent-sdk`, exe.dev
- **Setup** section replaced GitHub/Vercel prerequisites with just Bun + an Anthropic API key; added exe.dev deploy command
- **Environment Variables** table corrected: removed `GH_PAT` and `EVOLVE_LABEL` (no longer used), updated descriptions for `GITHUB_TOKEN`/`GITHUB_REPO` (optional git sync, not required)
- **Features** table added listing all current live features (file attachments, cross-device QR sign-in, RBAC, follow-up requests, upstream sync, etc.)
- **Hosting on exe.dev** section added: explains the three exe.dev capabilities Primordia uses (persistent dev server, built-in LLM gateway, SSO login via injected `X-ExeDev-Email` header) and provides a step-by-step guide for deploying your own Primordia instance on exe.dev

## Why

The README was dreadfully out of date and would mislead anyone trying to set up or understand the project. The exe.dev section was added because exe.dev is the intended hosting target and the integration (no API key, SSO login, one-command deploy) is not obvious from the code alone.
