# PRIMORDIA.md

> **This file is the living brain of Primordia.**
> Every time Claude Code runs — whether triggered by the evolve pipeline or manually — it should:
> 1. **Read this file first** to understand the current state of the app.
> 2. **Update this file last** — add a Changelog entry describing what changed and why.
>
> This file is the source of truth for architecture, features, and history.

---

## What Is Primordia?

Primordia is a self-modifying web application. Users interact with an AI chat interface and can switch into "evolve mode" to describe changes they want made to the app itself. Those requests are automatically turned into GitHub Pull Requests via a CI pipeline powered by Claude Code CLI.

The core idea: **the app becomes whatever its users need it to be**, with no coding or git knowledge required from users.

---

## Current Architecture

### Tech Stack
| Layer | Technology | Why |
|---|---|---|
| Frontend framework | Next.js 15 (App Router) | AI models write Next.js well; great Vercel integration |
| Styling | Tailwind CSS | AI models write Tailwind well; no CSS files to manage |
| Language | TypeScript | Catches mistakes; Claude Code understands it well |
| AI API | Anthropic SDK (`@anthropic-ai/sdk`) | Streaming chat via `claude-sonnet-4-6` |
| Hosting | Vercel | Zero-config deploys; automatic preview URLs per PR |
| Version control | GitHub | Issues → Actions → PRs pipeline |
| CI/AI code gen | GitHub Actions + Claude Code CLI | Runs `claude --print --no-interactive` against issues |

### File Map

```
primordia/
├── PRIMORDIA.md                   ← You are here. Read me first, update me last.
├── .env.example                   ← Copy to .env.local, fill in secrets
├── .gitignore
├── next.config.ts                 ← Minimal Next.js config
├── tailwind.config.ts
├── postcss.config.mjs
├── tsconfig.json
├── package.json
│
├── app/                           ← Next.js App Router
│   ├── layout.tsx                 ← Root layout (font, metadata, body styling)
│   ├── page.tsx                   ← Entry point — renders <ChatInterface>
│   ├── globals.css                ← Tailwind base imports only
│   └── api/
│       ├── chat/
│       │   └── route.ts           ← Streams Claude responses via SSE
│       └── evolve/
│           └── route.ts           ← Creates a labeled GitHub Issue
│
├── components/
│   ├── ChatInterface.tsx          ← Main chat UI; handles chat + evolve modes
│   └── ModeToggle.tsx             ← Toggle button: "Chat" vs "Evolve"
│
└── .github/
    └── workflows/
        └── evolve.yml             ← CI pipeline: issue → Claude Code → PR
```

### Data Flow

#### Normal Chat
```
User types message
  → POST /api/chat
  → Anthropic API (claude-sonnet-4-6, streaming)
  → SSE stream back to browser
  → Message appended to chat
```

#### Evolve Request
```
User types change request in evolve mode
  → POST /api/evolve
  → GitHub API: create Issue labeled "primordia-evolve"
  → GitHub Actions: evolve.yml triggered
      → git checkout -b evolve/issue-{N}
      → claude --print --no-interactive -p "{issue body + PRIMORDIA.md}"
      → git commit && git push
      → gh pr create
      → gh issue comment (PR link)
  → Vercel: preview deployment auto-created for the PR
  → Repo owner reviews + merges PR
  → Vercel: production deployment triggered
```

---

## Environment Variables

These must be set in:
- **Local development**: `.env.local` (copy from `.env.example`)
- **Vercel**: Project Settings → Environment Variables
- **GitHub Actions**: Repository Settings → Secrets and Variables → Actions

| Variable | Required | Description |
|---|---|---|
| `ANTHROPIC_API_KEY` | Yes | Powers the chat interface and Claude Code CLI in CI |
| `GITHUB_TOKEN` | Yes (app) | Allows the app to create GitHub Issues |
| `GITHUB_REPO` | Yes (app) | The `owner/repo` the app lives in |
| `EVOLVE_LABEL` | No (default: `primordia-evolve`) | Issue label that triggers the workflow |
| `GH_PAT` | Yes (CI) | GitHub PAT for the Actions workflow to open PRs |

---

## Setup Checklist (One-Time)

1. **Fork or clone** this repo to your GitHub account.
2. **Connect to Vercel**: import the repo at vercel.com/new.
3. **Set Vercel environment variables**: `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO`.
4. **Create the GitHub Issue label**: go to `github.com/{owner}/{repo}/labels`, create `primordia-evolve` (color: `#f0a500`).
5. **Add GitHub Actions secrets**: `ANTHROPIC_API_KEY` and `GH_PAT` in repo Settings → Secrets.
6. **Deploy**: push to `main` or trigger a Vercel deploy. The app is live.

---

## Design Principles for Claude Code

When implementing changes, follow these principles:

1. **Read PRIMORDIA.md first.** Understand the current architecture before making changes.
2. **Minimal changes.** Only modify what is necessary for the user's request.
3. **No clever magic.** Write code that is easy for another AI to read and modify later.
4. **Minimal dependencies.** Every new dependency is a future maintenance burden. Avoid them unless essential.
5. **TypeScript everywhere.** Explicit types make the codebase more navigable for AI models.
6. **Tailwind for styling.** Do not add CSS files or CSS-in-JS libraries.
7. **App Router conventions.** Follow Next.js App Router patterns: `page.tsx`, `layout.tsx`, `route.ts`.
8. **Update PRIMORDIA.md last.** Add a Changelog entry after every set of changes.

---

## Current Features

| Feature | Status | Notes |
|---|---|---|
| Chat interface (streaming) | ✅ Live | Streams from `claude-sonnet-4-6` via SSE |
| Evolve mode | ✅ Live | Creates labeled GitHub Issue |
| CI evolve pipeline | ✅ Live | `evolve.yml` → Claude Code → PR |
| Vercel deploy pipeline | ✅ Live (setup required) | Preview per PR, prod on merge to main |
| Dark theme | ✅ Live | Default dark UI with Tailwind |

---

## Stretch Goals (Not Implemented)

These were noted at project inception but are explicitly out of scope for the MVP:

- **Fork flow**: one-click fork to user's own GitHub + Vercel
- **Voting**: upvote proposed evolve requests before they get built
- **Rollback**: "go back to before X was added" via natural language
- **Multi-tenant**: each user gets their own Primordia instance

---

## Changelog

### 2026-03-14 — Live CI progress in Primordia chat

**What changed**:
- New `app/api/evolve/status/route.ts` endpoint: given an issue number, fetches (a) the latest Claude bot comment body + `updated_at`, (b) any open PR whose branch matches `claude/issue-{N}-*`, and (c) a Vercel deploy preview URL from PR comments.
- `components/ChatInterface.tsx` now starts polling that endpoint every 10 s after a successful evolve submit. A dedicated "CI Progress" message is added to the chat and **updated in-place** every time Claude's comment changes on GitHub, so users see the bot's live task-list as it ticks off items. Separate one-time messages are appended when the PR is created and when the deploy preview URL becomes available. Polling stops automatically on deploy preview or after 15 minutes.

**Why**: Claude's github comment is continuously edited as CI progresses; showing only a one-time 400-char snapshot missed all the live updates. The new approach mirrors the comment in real time directly in the Primordia chat.

---

### 2026-03-14 — Fix WCAG 2 AA color contrast issues

**What changed**: Improved color contrast for two elements that failed the WCAG 2 AA 4.5:1 minimum ratio for normal text:
1. `<p>A self-evolving application</p>` subtitle: changed `text-gray-500` to `text-gray-400` (contrast on `bg-gray-950` improves from ~4.16:1 to ~7.9:1).
2. Evolve mode toggle button active state: changed `bg-amber-600` to `bg-amber-700` (contrast for white text improves from ~3.19:1 to ~5.0:1).

**Why**: Both elements failed the WCAG 2 AA threshold of 4.5:1 for normal (non-large) text, flagged by an accessibility audit.

---

### 2026-03-14 — Fix bold text duplication in SimpleMarkdown

**What changed**: Fixed a bug in `SimpleMarkdown` where bold text (`**text**`) was rendered twice — once as a `<strong>` element and once as a plain `<span>`.

**Why**: `String.split()` with a regex that has capturing groups includes those captured sub-groups in the result array. The split regex had inner capturing groups (e.g., `([^*]+)` inside `\*\*([^*]+)\*\*`), so for each bold token the array contained both the full `**text**` match and the inner `text` capture. The fix converts all inner groups to non-capturing (`(?:...)`) so only the full token appears in the split result.

---

### 2026-03-14 — Initial Scaffold

**What changed**: Built the entire initial scaffold from scratch.

**Included**:
- Next.js 15 app with TypeScript and Tailwind CSS
- Two-mode chat interface: "chat" (talks to Claude) and "evolve" (opens a GitHub Issue)
- `ModeToggle` component for switching between modes
- `/api/chat` route: streams Claude responses via SSE
- `/api/evolve` route: creates a labeled GitHub Issue via the GitHub API
- `evolve.yml` GitHub Actions workflow: triggered by the `primordia-evolve` label, runs Claude Code CLI, commits changes, opens a PR, and comments on the originating issue
- `PRIMORDIA.md` (this file): living architecture document and changelog

**Why**: This is the first version — the foundation everything else evolves from.
