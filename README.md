# Primordia

<p align="center">
  <img src="public/primordia-logo.png" alt="Primordia logo" width="120" />
</p>

> A self-modifying web application. Describe changes in plain English — Primordia builds them for you.

Primordia is a chat interface powered by Claude. Users can open the **hamburger (☰) menu** in the header and choose **"Propose a change"** to open the evolve dialog and describe changes they want made to the app itself. Those requests are automatically built as local git worktree previews via the Claude Agent SDK — no coding or git knowledge required.

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
| Framework | Next.js 16 (App Router) |
| Styling | Tailwind CSS |
| Language | TypeScript |
| AI (chat) | Anthropic SDK — `claude-sonnet-4-6` via SSE |
| AI (code gen) | `@anthropic-ai/claude-agent-sdk` — `query()` in git worktrees |
| Database | bun:sqlite — passkey auth + evolve session persistence |
| Hosting | exe.dev (remote dev server) or local `bun run dev` |

## Setup

### Prerequisites
- [Bun](https://bun.sh) runtime
- An Anthropic API key — required for the evolve (Claude Code) pipeline in all environments. The chat interface can use the exe.dev LLM gateway instead when running on exe.dev.

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

This SSH-deploys to `<server-name>.exe.xyz`, installs dependencies, and starts Primordia as a systemd service. The exe.dev LLM gateway handles the chat interface without an `ANTHROPIC_API_KEY`, but the evolve pipeline (Claude Code) still requires one.

## Hosting on exe.dev

[exe.dev](https://exe.dev) provides persistent remote development servers. Primordia is built to run there — it uses the built-in LLM gateway (no API key needed) and supports one-click sign-in via your exe.dev account.

| Capability | How Primordia uses it |
|---|---|
| Persistent remote dev server | Runs as a `systemd` service (`primordia-proxy`) in production mode (`bun run build && bun run start`); blue/green slot swap on accept |
| Built-in LLM gateway | Chat is routed through the exe.dev proxy — no `ANTHROPIC_API_KEY` needed for chat. The evolve pipeline (Claude Code) still requires `ANTHROPIC_API_KEY`. |
| SSO login | The proxy injects an `X-ExeDev-Email` header; Primordia finds or creates a user automatically |

### Create your own Primordia on exe.dev

1. **Fork** this repo to your GitHub account.
2. **Create a server** on [exe.dev](https://exe.dev). Note the server name (e.g. `myapp` → `myapp.exe.xyz`).
3. **Configure `.env.local`** — copy `.env.example` and set at minimum:
   - `ANTHROPIC_API_KEY` — required for the evolve (Claude Code) pipeline
   - `GITHUB_REPO=your-username/primordia` — used by the deploy script to clone your fork onto the server
   - `GITHUB_TOKEN` (optional) — PAT with `repo` scope; enables git pull/push from the server via the Git Sync dialog
4. **Deploy:**
   ```bash
   bun run deploy-to-exe.dev <server-name>
   ```
   The script will:
   - Copy your `.env.local` to the server via `scp`
   - Install `git` and `bun` if missing
   - Clone your repo and install dependencies
   - Start Primordia as a `systemd` service and wait for it to be ready
5. **Open** `http://<server-name>.exe.xyz:3000`.
6. **Sign in** — click *Login with exe.dev* on the login page. The first user to sign in is automatically granted the `admin` role.

> The chat interface works on exe.dev without an `ANTHROPIC_API_KEY` — the built-in gateway handles it. However, the evolve pipeline (Claude Code via `@anthropic-ai/claude-agent-sdk`) always requires `ANTHROPIC_API_KEY`.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Required for evolve | Required for the evolve pipeline (Claude Code) in all environments. Not required for chat on exe.dev — the built-in gateway is used instead. |
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

See [CLAUDE.md](./CLAUDE.md) for the full architecture document, design principles, and file map.
