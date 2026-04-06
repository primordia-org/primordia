# Fix symlink-to-symlink chain for session `.env.local`

## What changed

In `lib/evolve-sessions.ts`, the step that symlinks `.env.local` into a new session worktree now resolves the source path to its real target before creating the symlink.

**Before:**
```ts
fs.symlinkSync(srcEnv, dstEnv);
// session/.env.local → current-slot/.env.local → main/.env.local
```

**After:**
```ts
const resolvedEnv = fs.realpathSync(srcEnv);
fs.symlinkSync(resolvedEnv, dstEnv);
// session/.env.local → main/.env.local  (direct)
```

## Why

The server's `repoRoot` is the current active slot directory (e.g. `primordia-worktrees/some-slot`). That slot's `.env.local` is itself a symlink pointing to `main/.env.local` — set up during the accept flow (step 4c in `manage/route.ts`) to keep the active slot pointing at the single real copy.

When a new session worktree was created, we were symlinking to `some-slot/.env.local` rather than to the underlying real file. This created a chain:

```
session/.env.local → some-slot/.env.local → main/.env.local
```

Two accepts later, `some-slot` is deleted as the old "two-accepts-ago" slot. At that point `some-slot/.env.local` vanishes, leaving the session worktree with a dangling symlink and no credentials — causing the preview dev server to start without any environment variables.

Using `fs.realpathSync` resolves the full symlink chain at creation time, so session worktrees always point directly to the real `.env.local` file, which lives in the `main` repo worktree and is never deleted.
