# lib/ — Architecture Reference

This file covers shared utilities in `lib/` and the git config key-value store pattern used throughout the codebase.

---

## Git Config as Key-Value Store

Primordia uses `.git/config` as a lightweight key-value store for **non-sensitive runtime state** (no secrets — use `.env.local`; no user data — use SQLite). The reverse proxy reads it directly without starting Next.js.

### Established namespaces

| Namespace | Example key | What it stores |
|---|---|---|
| `primordia.*` | `primordia.productionBranch` | App-wide settings; proxy reads these live via `fs.watch` on `.git/config` |
| `primordia.*` | `primordia.productionHistory` | Multi-value list of previous production branch names (written with `--add`) |
| `primordia.*` | `primordia.previewInactivityMin`, `primordia.prodInactivityMin` | Proxy tuning knobs (see `app/api/admin/proxy-settings/route.ts`) |
| `branch.{name}.*` | `branch.main.port` | Per-branch ephemeral port; proxy discovers preview servers this way |
| `branch.{name}.*` | `branch.feature-x.parent` | Legacy parent branch metadata; still written while branch-marker commit trailer tracking (`lib/branch-parent.ts`) is validated via a user-toggleable source setting |
| `remote.{name}.*` | `remote.primordia-official.updateSource` | Update source metadata extending the standard git remote section (see `lib/update-sources.ts`) |

### Output format of `--get-regexp`

Each line is `<key><space><value>` with no `=`. Git **lowercases the section and field names** but **preserves the subsection name's case**. Always split on the first space. Use `[^.]+` (not `.*`) in regexes to avoid greedy matches across dots.

### Code reference

See `lib/update-sources.ts` for the subsection pattern. See `lib/evolve-sessions.ts` (`getOrAssignBranchPort`) for a simple single-key read/write example.
