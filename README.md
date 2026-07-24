# Primordia

<p align="center">
  <img src="public/primordia-logo.png" alt="Primordia logo" width="120" />
</p>

> Your app with agentic coding built in.

[![Deploy on exe.dev](https://raw.githubusercontent.com/boldsoftware/exe.dev/main/assets/buttons/deploy-on-exe-dev.png)](https://exe.dev/new?repo=https://github.com/primordia-org/primordia)

Primordia is a chat interface powered by an AI agent. Users can open the **hamburger (☰) menu** in the header and choose **"Propose a change"** to open the thread dialog and describe changes they want made to the app itself. Those requests are automatically built as local git worktree previews via the AI coding agent SDK — no coding or git knowledge required.

## How It Works

### Normal Chat
Talk to an AI agent directly. Primordia streams responses from the Anthropic SDK via SSE.

### Threads
Describe a change you want (e.g. *"add a dark mode toggle"* or *"make the header sticky"*). Primordia will:

1. Create a git branch + worktree for your request
2. Run an AI coding agent inside the worktree
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
| AI (chat) | Anthropic SDK via SSE |
| AI (code gen) | Anthropic Agent SDK — `query()` in git worktrees |
| Database | bun:sqlite — passkey auth + thread persistence |
| Hosting | Local machine, VM, or exe.dev via the one-line installer |

## Setup

Install Primordia on a local machine, VM, or exe.dev server with one command:

```bash
curl -fsSL https://primordia.exe.xyz/install.sh | bash -s
```

The installer checks system requirements, installs the pinned runtime when needed, creates the production configuration, and starts Primordia as a service. When it finishes, it prints the URL to open.

The first user to register is automatically granted the `admin` role.

## Hosting on exe.dev

[exe.dev](https://exe.dev) provides persistent remote development servers. Primordia is built to run there — it uses the built-in LLM gateway (no API key needed) and supports one-click sign-in via your exe.dev account.

| Capability | How Primordia uses it |
|---|---|
| Persistent remote dev server | Runs as a `systemd` service (`primordia-proxy`) in production mode (`bun run build && bun run start`); blue/green slot swap on accept |
| Built-in LLM gateway | All LLM requests (chat and threads) are routed through the exe.dev gateway — no API key needed |
| SSO login | The proxy injects an `X-ExeDev-Email` header; Primordia finds or creates a user automatically |

### Create your own Primordia on exe.dev

Click the **Deploy on exe.dev** button above, or create an exe.dev server and run the same one-line installer:

```bash
curl -fsSL https://primordia.exe.xyz/install.sh | bash -s
```

The installer clones Primordia, installs dependencies and the pinned runtime if missing, starts the `primordia` service, and prints the URL to open.

Sign in with exe.dev on the login page. The first user to sign in is automatically granted the `admin` role.

> Both the chat interface and the thread pipeline use the exe.dev LLM gateway — no API key is needed.

## Environment Variables

| Variable | Required | Description |
|---|---|---|
| `REVERSE_PROXY_PORT` | Usually no | Port the reverse proxy listens on. The installer writes this automatically; set it manually only for source checkouts or custom deployments. |

## Features

| Feature | Status |
|---|---|
| Chat interface (streaming) | ✅ Live |
| Thread mode — local worktree pipeline | ✅ Live |
| File attachments in thread requests | ✅ Live |
| Follow-up requests on existing branches | ✅ Live |
| Upstream changes indicator (merge/rebase) | ✅ Live |
| Passkey authentication (WebAuthn) | ✅ Live |
| Cross-device QR sign-in | ✅ Live |
| RBAC — admin and thread access roles | ✅ Live |
| One-line installer for local machines, VMs, and exe.dev | ✅ Live |
| Dark theme | ✅ Live |

## Architecture

See [CLAUDE.md](./CLAUDE.md) for the full architecture document, design principles, and file map.
