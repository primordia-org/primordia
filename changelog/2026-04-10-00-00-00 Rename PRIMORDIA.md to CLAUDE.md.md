# Rename PRIMORDIA.md to CLAUDE.md

## What changed

- Renamed `PRIMORDIA.md` to `CLAUDE.md` (via `git mv`, preserving history).
- Updated all references to `PRIMORDIA.md` across the codebase:
  - `CLAUDE.md` itself — title, file map entry, system-prompt description, design principle #1, and changelog section footer.
  - `lib/system-prompt.ts` — comment and `readFileSync` call now reference `CLAUDE.md`; system prompt tool description updated.
  - `lib/evolve-sessions.ts` — both evolve prompts (initial and follow-up) updated to instruct Claude to read `CLAUDE.md` first; changelog instruction updated to say "Do NOT add changelog entries to CLAUDE.md itself."
  - `README.md` — architecture link updated to `[CLAUDE.md](./CLAUDE.md)`.
  - `.gitattributes` — union merge rule updated from `PRIMORDIA.md merge=union` to `CLAUDE.md merge=union`.

## Why

`CLAUDE.md` is the standard convention for Claude Code's architecture/context file. Renaming from `PRIMORDIA.md` aligns the project with this convention, making it immediately recognizable to anyone familiar with Claude Code that this file is the "read me first" context document.
