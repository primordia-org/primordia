# Add out-of-the-box features section to landing page

## What changed

Added a new **"Everything you need, out of the box"** section to the landing page, inserted between the "What is Primordia?" intro section and the "How it works" steps section.

The section contains nine feature tiles arranged in a perfect 3×3 responsive grid:

- **Passkey Authentication** — passwordless sign-in, no third-party auth service
- **Role-Based Access** — admin and evolver roles, auto-granted to first user
- **Admin Dashboard** — live logs, disk/memory health, deep rollbacks, remote mirroring, upstream updates
- **Full Change History** — every change versioned; one-click rollback to any prior production snapshot
- **Live AI Previews** — browser preview of every AI-generated change before it goes live
- **Automatic Updates** — pull upstream Primordia improvements via the admin panel, on your schedule
- **Secure Secret Storage** — client-side hybrid envelope encryption; server never sees plaintext secrets
- **Decisions Already Made** — framework, database, auth, AI integration, and deployment pre-chosen
- **Your AI, Your Way** — connect an existing Claude or ChatGPT subscription, or paste an Anthropic, OpenAI, or OpenRouter API key

Also fixed a layout bug in the "What is Primordia?" section: the grid declared `sm:grid-cols-3` for only two cards; corrected to `sm:grid-cols-2`.

### Landing page copy improvements

- Removed all instances of "Git" from landing page copy (too technical for a marketing page)
- Removed "WebAuthn" from the Passkey Authentication tile description
- Removed "git mirror" from the Admin Dashboard description
- Renamed "Full Git History" tile to "Full Change History"
- Replaced "One-Command Deploy" tile with "Automatic Updates"
- Removed "Fork" and "repo" from the Open Source card (rewrote as "customize the source code")
- Fixed "Four steps" → "Three steps" in the How it works section (there are only 3 steps)
- Added "Your AI, Your Way" tile highlighting ChatGPT/Claude subscription support and Anthropic/OpenAI/OpenRouter API key options

### CTABannerSection simplified

The "Ready to deploy?" banner at the bottom now shows a single curl one-liner that assumes the user is running the command on their exe.dev VM, rather than the full two-step SSH + curl interactive block. The command is `curl -fsSL {installUrl} | bash [-s {branch}]`.

### New page: /under-the-hood

Added `app/under-the-hood/page.tsx` — "But how does it work, really?" — a technical deep-dive page that holds all the jargon removed from the landing page:

- WebAuthn / FIDO2 passkey mechanics
- Git as the change-tracking backend
- How AI agents (Claude Code, Codex, pi) run in isolated git worktrees; support for follow-up chained passes
- Blue-green zero-downtime proxy swap
- SQLite + VACUUM INTO for database snapshots
- Hybrid AES-GCM + RSA-OAEP secret encryption
- Full tech stack table with rationale for each choice

Linked from the landing page footer as "How it works".

## Why

The landing page previously mixed marketing copy with technical jargon ("Git", "WebAuthn") that would confuse non-technical visitors. Moving the jargon to a dedicated technical page keeps the landing page accessible while giving curious or technical users a place to find the full picture.

The Automatic Updates tile replaces One-Command Deploy (which belonged more in the CTA section), and the Security and Architecture tiles fill gaps that weren't previously highlighted — both are meaningful differentiators for anyone evaluating Primordia as a foundation.

The "Your AI, Your Way" tile addresses a common question: do you need to pay for a new AI subscription just to use Primordia? The answer is no — existing Claude or ChatGPT subscriptions work, and Anthropic, OpenAI, or OpenRouter API keys are all supported. (Free models via OpenRouter require an OpenRouter key; the built-in gateway only covers Anthropic and OpenAI models.) The Secure Secret Storage tile no longer uses the word "ciphertext" — replaced with plain-English "The server never sees them in plaintext".

The /under-the-hood page intro was updated to remove a joke that implied the landing page was dishonest; Primordia has no secrets from its users. The agent section was expanded to accurately describe all supported harnesses (Claude Code, Codex, pi) and mention chained follow-up requests.
