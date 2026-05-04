# Fix @mariozechner/pi-coding-agent Turbopack external import failure

## Problem

Fresh evolve-session worktrees frequently threw this runtime error on the first
page load:

```
Failed to load external module @mariozechner/pi-coding-agent-25ed40b2b9196719:
ResolveMessage: Cannot find module '@mariozechner/pi-coding-agent-25ed40b2b9196719'
from '.../.next/dev/server/chunks/ssr/[turbopack]_runtime.js'
  at externalImport ([turbopack]_runtime.js:607:19)
```

### Root cause

`@mariozechner/pi-coding-agent` is an ESM-only package (`"type": "module"` in
its `package.json`).  When Turbopack marks a package as an external ESM module
(via `serverExternalPackages`), it does two things at compilation time:

1. Emits a chunk that calls `externalImport('<name>-<content-hash>')` — a
   content-hashed alias rather than the bare package name.
2. Creates a symlink `.next/dev/node_modules/@mariozechner/pi-coding-agent-<hash>`
   pointing to the real `node_modules/` entry.

In a brand-new worktree the `.next/` tree is empty.  Turbopack creates both the
compiled chunk and the symlink during the first compilation, but in some cases
the compiled chunk starts executing before the symlink is in place, so
`externalImport` fails with "Cannot find module".

Because `@mariozechner/pi-coding-agent` was statically imported at module
initialisation time (via `lib/pi-model-registry.server.ts` →
`lib/user-prefs.ts` → every page with a hamburger menu), the failure happened
on virtually every first-hit page render in a fresh worktree.

## Fix

Remove `@mariozechner/pi-coding-agent` from the static import graph entirely:

- **`lib/models.generated.json`** — new file; holds the filtered, formatted
  model list produced by the pi `ModelRegistry`.
- **`lib/agent-config.ts`** — imports `models.generated.json` directly (plain
  JSON import, no pi SDK needed).  Both server and client code can import this
  file safely.
- **`app/api/evolve/models/route.ts`** — now returns `MODEL_OPTIONS` from
  `agent-config` instead of calling `getModelOptionsByHarness()`.
- **`lib/user-prefs.ts`** — validates saved model preferences against
  `MODEL_OPTIONS` inline; no longer imports `pi-model-registry.server`.
- **`lib/evolve-sessions.ts`** — resolves model labels via `MODEL_OPTIONS`
  inline; no longer imports `pi-model-registry.server`.
- **`lib/pi-model-registry.server.ts`** — kept for reference but no longer
  imported anywhere in the app.

`@mariozechner/pi-coding-agent` is still installed and used at runtime by the
pi worker process (`scripts/pi-worker.ts`), which runs outside of
Turbopack/Next.js and is unaffected by this change.

## Keeping the list up to date

A new script regenerates `lib/models.generated.json` from the live pi registry:

```bash
bun run regenerate:model-registry
```

Run this after updating `@mariozechner/pi-coding-agent` to a new version.  The
script (`scripts/regenerate-model-registry.ts`) applies the same filtering
rules (drop `(latest)`, dated snapshots, Chat/Turbo/Max variants, nano/pro
tiers; keep highest version per family) as the old dynamic registry.
