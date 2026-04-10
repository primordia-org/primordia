# Check session ID uniqueness against DB before committing

## What changed

`findUniqueBranch` in `app/api/evolve/route.ts` now accepts a `sessionExists` callback and checks both git branches **and** the `evolve_sessions` SQLite table before committing to a session ID.

The `POST /api/evolve` handler passes a callback that calls `db.getEvolveSession(id)`, so any slug that already has a DB row (even from a previously rejected/deleted session) is skipped and the next suffix (`-2`, `-3`, …) is tried instead.

The duplicate `const db = await getDb()` call was removed — `db` is now obtained once, before `findUniqueBranch`, and reused for both the uniqueness check and the `createEvolveSession` insert.

## Why

Rejected sessions are removed from git (branch deleted, worktree removed) but their rows persist in `evolve_sessions`. If a later request generated the same slug, `findUniqueBranch` would return the same name (no git branch conflict), but `createEvolveSession` would then throw:

```
SQLiteError: UNIQUE constraint failed: evolve_sessions.id
```

By also checking the DB during candidate selection we guarantee the chosen ID is free in both git and SQLite before the insert is attempted.
