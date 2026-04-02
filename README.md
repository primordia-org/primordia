# Primordia

<p align="center">
  <img src="public/primordia-logo.png" alt="Primordia logo" width="120" />
</p>

> A self-modifying web application. Describe changes in plain English — Primordia builds them for you.

Primordia is a chat interface powered by Claude. Users can click the **Edit (pencil) icon** in the header to navigate to the `/evolve` page and describe changes they want made to the app itself. Those requests are automatically built as local git worktree previews via the Claude Agent SDK — no coding or git knowledge required.

## How It Works

### Normal Chat
Talk to Claude directly. Primordia streams responses from `claude-sonnet-4-6`.

### Evolve Mode
Describe a change you want (e.g. *"add a dark mode toggle"* or *"make the header sticky"*). Primordia will:

1. Create a git branch + worktree for your request
2. Run Claude Code (via `@anthropic-ai/claude-agent-sdk`) inside the worktree
3. Spin up a local preview dev server on a free port
4. Show you a live preview link and a progress log
5. Click **Accept** to merge the branch into main, or **Reject** to discard it

You can attach images or files to any request. Follow-up requests on the same branch are also supported.

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Styling | Tailwind CSS |
| Language | TypeScript |
| AI (chat) | Anthropic SDK — `claude-sonnet-4-6` via SSE |
| AI (code gen) | `@anthropic-ai/claude-agent-sdk` — `query()` in git worktrees |
| Database | bun:sqlite — passkey auth + evolve session persistence |
| Hosting | exe.dev (remote dev server) or local `bun run dev` |

## Setup

### Prerequisites
- [Bun](https://bun.sh) runtime
- An Anthropic API key (not required on exe.dev — the built-in LLM gateway is used automatically)

### Local Development

```bash
cp .env.example .env.local
# Fill in ANTHROPIC_API_KEY (and optionally GITHUB_TOKEN + GITHUB_REPO)

bun install
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

The first user to register is automatically granted the `admin` role.

### Deploy to exe.dev

```bash
bun run deploy-to-exe.dev <server-name>
```

This SSH-deploys to `<server-name>.exe.xyz`, installs dependencies, and starts the app. No `ANTHROPIC_API_KEY` needed — the exe.dev LLM gateway is used automatically.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Conditional | Powers the chat interface. Not required on exe.dev (built-in gateway). Required outside exe.dev. |
| `GITHUB_TOKEN` | No | PAT (repo scope) — enables authenticated git pull/push in the Git Sync dialog. |
| `GITHUB_REPO` | No | `owner/repo` slug — used with `GITHUB_TOKEN` to build the authenticated remote URL. |

## Features

| Feature | Status |
|---|---|
| Chat interface (streaming) | ✅ Live |
| Evolve mode — local worktree pipeline | ✅ Live |
| File attachments in evolve requests | ✅ Live |
| Follow-up requests on existing branches | ✅ Live |
| Upstream changes indicator (merge/rebase) | ✅ Live |
| Passkey authentication (WebAuthn) | ✅ Live |
| Cross-device QR sign-in | ✅ Live |
| RBAC — `admin` and `can_evolve` roles | ✅ Live |
| exe.dev one-command deploy | ✅ Live |
| Dark theme | ✅ Live |

## Architecture

See [PRIMORDIA.md](./PRIMORDIA.md) for the full architecture document, design principles, and file map.
