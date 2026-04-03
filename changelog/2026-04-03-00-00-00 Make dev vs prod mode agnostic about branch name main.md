# Make dev vs prod mode agnostic about branch name 'main'

## What changed

- **`lib/page-title.ts`**: The logic that decides whether to include the port and branch name in page titles now hinges on `NODE_ENV === "production"` instead of checking `branch === "main"`. Running `bun run build` (and `bun run start`) sets `NODE_ENV=production`, so any production build gets clean titles (`Primordia`, `Chat — Primordia`, etc.) regardless of which branch it was built from. Development mode (`bun run dev`) always includes the diagnostic port and branch suffix, again regardless of branch name.

- **`app/api/evolve/manage/route.ts`**: The decision between blue/green and legacy accept now hinges on `NODE_ENV === 'production'` instead of checking whether a `primordia-worktrees/current` symlink exists. The old `findCurrentSymlink` helper is removed. The `currentSymlink` path is now constructed directly from `worktreePath` when in production mode, rather than being discovered via filesystem probe. Also updated a comment on step 7b of `blueGreenAccept` — it previously cited `page-title.ts` as a reason to re-attach HEAD; since page-title.ts no longer reads the git branch in production, only the `/branches` page still benefits from that HEAD attachment.

- **`PRIMORDIA.md`**: Updated the file-map description for `page-title.ts` to reflect the new production/development distinction.

## Why

The previous implementation had two behaviors keyed to the literal branch name `"main"`:

1. Page titles omitted port/branch info only when the current git branch was exactly `"main"`.
2. There were comments and some worktree logic that referenced 'main' as the special production branch.

This created accidental coupling: running a production deploy from a differently-named branch would produce titles polluted with port and branch info, and git's restriction on checking out the same branch in multiple worktrees was an occasional friction point.

The real distinction that matters is **development vs production mode** — which is already what `NODE_ENV` captures. Making the code express that intent directly removes the dependency on the branch name and lets the system work correctly regardless of what the production branch is called.
