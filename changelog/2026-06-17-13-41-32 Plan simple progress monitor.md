# Plan simple progress monitor

Documented a replacement plan for the Pi-only EDB todo extension. The plan works backwards from the desired Evolve Session progress UX and proposes a small Primordia-owned `progress_*` NDJSON protocol plus a dependency-free `bun run progress` command usable by Pi, Claude Code, and Codex.

The document explains the target UI, non-goals, event schema, prompt contract, migration phases, and acceptance criteria so the future implementation can remove the external todo dependency while preserving historical session rendering. It also specifies weighted steps from day one and a reducer/state model that guarantees only one current active step for action grouping.
