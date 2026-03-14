# Primordia

> A self-modifying web application. Describe changes in plain English — Primordia builds them for you.

Primordia is a chat interface powered by Claude. Users can switch into **evolve mode** to describe changes they want made to the app itself. Those requests are automatically turned into GitHub Pull Requests via a CI pipeline — no coding or git knowledge required.

## How It Works

### Normal Chat
Talk to Claude directly. Primordia streams responses from `claude-sonnet-4-6`.

### Evolve Mode
Describe a change you want (e.g. *"add a dark mode toggle"* or *"make the header sticky"*). Primordia will:

1. Open a GitHub Issue with your request
2. Trigger a GitHub Actions workflow that runs Claude Code CLI
3. Claude Code reads the codebase, makes the changes, commits them, and opens a PR
4. A Vercel preview deployment is automatically created for the PR
5. Review and merge the PR — the change goes live

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router) |
| Styling | Tailwind CSS |
| Language | TypeScript |
| AI | Anthropic SDK (`claude-sonnet-4-6`) |
| Hosting | Vercel |
| CI / Code gen | GitHub Actions + Claude Code CLI |

## Setup

### Prerequisites
- A GitHub account
- A Vercel account
- An Anthropic API key
- A GitHub Personal Access Token (PAT) with repo permissions

### Steps

1. **Fork this repo** to your GitHub account.

2. **Connect to Vercel**: import the repo at [vercel.com/new](https://vercel.com/new).

3. **Set Vercel environment variables** (Project Settings → Environment Variables):

   | Variable | Description |
   |---|---|
   | `ANTHROPIC_API_KEY` | Powers the chat interface |
   | `GITHUB_TOKEN` | Allows the app to create GitHub Issues |
   | `GITHUB_REPO` | Your `owner/repo` (e.g. `yourname/primordia`) |

4. **Create the GitHub Issue label**: go to `github.com/{owner}/{repo}/labels` and create a label named `primordia-evolve` (suggested color: `#f0a500`).

5. **Add GitHub Actions secrets** (Settings → Secrets and Variables → Actions):

   | Secret | Description |
   |---|---|
   | `ANTHROPIC_API_KEY` | Used by Claude Code CLI in CI |
   | `GH_PAT` | PAT used to open PRs and post comments |

6. **Deploy**: push to `main` or trigger a Vercel deploy. The app is live.

### Local Development

```bash
cp .env.example .env.local
# Fill in the values in .env.local

npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

| Variable | Required | Where |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Vercel + GitHub Actions |
| `GITHUB_TOKEN` | Yes | Vercel |
| `GITHUB_REPO` | Yes | Vercel |
| `GH_PAT` | Yes | GitHub Actions |
| `EVOLVE_LABEL` | No (default: `primordia-evolve`) | Vercel |

## Architecture

See [PRIMORDIA.md](./PRIMORDIA.md) for the full architecture document, design principles, and changelog.
