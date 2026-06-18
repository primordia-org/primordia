# Plan simple progress monitor

Documented a replacement plan for the Pi-only EDB todo extension. The plan works backwards from the desired Evolve Session UX and proposes a small Primordia-owned `progress_*` NDJSON protocol plus a dependency-free `bun run progress` command usable by Pi, Claude Code, and Codex.

The final plan defines weighted steps, a single current-step reducer, automatic `Make a plan` initialization, current-step-relative future planning, one-command step completion, contextual command output, and compatibility for existing TodoWrite/Pi Task session logs.
