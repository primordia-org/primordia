# Add out-of-the-box features section to landing page

## What changed

Added a new **"Everything you need, out of the box"** section to the landing page, inserted between the "What is Primordia?" intro section and the "How it works" steps section.

The section contains eight feature tiles arranged in a responsive 1→2→3 column grid:

- **Passkey Authentication** — passwordless sign-in, no third-party auth service
- **Role-Based Access** — admin and evolver roles, auto-granted to first user
- **Admin Dashboard** — live logs, disk/memory health, deep rollbacks, remote mirroring, upstream updates
- **Full Change History** — every change versioned; one-click rollback to any prior production snapshot
- **Live AI Previews** — browser preview of every AI-generated change before it goes live
- **Automatic Updates** — pull upstream Primordia improvements via the admin panel, on your schedule
- **Secure Secret Storage** — client-side hybrid envelope encryption; server never sees plaintext secrets
- **Decisions Already Made** — framework, database, auth, AI integration, and deployment pre-chosen

Also fixed a layout bug in the "What is Primordia?" section: the grid declared `sm:grid-cols-3` for only two cards; corrected to `sm:grid-cols-2`.

### Landing page copy improvements

- Removed all instances of "Git" from landing page copy (too technical for a marketing page)
- Removed "WebAuthn" from the Passkey Authentication tile description
- Removed "git mirror" from the Admin Dashboard description
- Renamed "Full Git History" tile to "Full Change History"
- Replaced "One-Command Deploy" tile with "Automatic Updates"

### CTABannerSection simplified

The "Ready to deploy?" banner at the bottom now shows a single curl one-liner that assumes the user is running the command on their exe.dev VM, rather than the full two-step SSH + curl interactive block. The command is `curl -fsSL {installUrl} | bash [-s {branch}]`.

### New page: /under-the-hood

Added `app/under-the-hood/page.tsx` — "But how does it work, really?" — a technical deep-dive page that holds all the jargon removed from the landing page:

- WebAuthn / FIDO2 passkey mechanics
- Git as the change-tracking backend
- How the AI agent runs Claude Code in git worktrees
- Blue-green zero-downtime proxy swap
- SQLite + VACUUM INTO for database snapshots
- Hybrid AES-GCM + RSA-OAEP secret encryption
- Full tech stack table with rationale for each choice

Linked from the landing page footer as "How it works".

## Why

The landing page previously mixed marketing copy with technical jargon ("Git", "WebAuthn") that would confuse non-technical visitors. Moving the jargon to a dedicated technical page keeps the landing page accessible while giving curious or technical users a place to find the full picture.

The Automatic Updates tile replaces One-Command Deploy (which belonged more in the CTA section), and the Security and Architecture tiles fill gaps that weren't previously highlighted — both are meaningful differentiators for anyone evaluating Primordia as a foundation.
