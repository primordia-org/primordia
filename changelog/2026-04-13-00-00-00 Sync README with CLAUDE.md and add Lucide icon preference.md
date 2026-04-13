# Sync README with CLAUDE.md and add Lucide icon preference

## What changed

### README.md corrections

- **Next.js version**: Updated "Next.js 15" → "Next.js 16" to match `package.json` (`next@16.2.2`) and CLAUDE.md.
- **Evolve entry point**: Replaced "click the Edit (pencil) icon in the header" with "open the hamburger (☰) menu and choose 'Propose a change'" — the pencil icon no longer exists; the evolve dialog is now opened via the hamburger menu.
- **exe.dev hosting table**: Corrected "Runs `bun run dev` as a `systemd` service (`NODE_ENV=development`)" → "Runs as a `systemd` service (`primordia-proxy`) in production mode (`bun run build && bun run start`); blue/green slot swap on accept" — Primordia runs in production mode on exe.dev, not dev mode.

### CLAUDE.md addition

- Added design principle **"Prefer Lucide for icons"** (principle #9): use `lucide-react` for all icons; avoid other icon libraries unless a specific icon is unavailable in Lucide.

## Why

The README had drifted from the actual codebase state as the project evolved. These corrections bring it back in sync with `package.json` and CLAUDE.md. The Lucide preference codifies an implicit convention so Claude Code and contributors reach for a consistent icon library.
