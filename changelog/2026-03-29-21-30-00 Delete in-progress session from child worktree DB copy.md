# Delete in-progress session from child worktree DB copy

## What changed

After `git worktree add` and `bun install` complete, `startLocalEvolve` copies
the parent's SQLite database into the new worktree so each branch gets its own
isolated data snapshot. Previously this copy happened **after** the session had
already logged two progress entries ("Creating worktree …" and "Running `bun
install` …"), so the child worktree's DB contained the current session in a
partial, in-progress state. Any user browsing the evolve session history inside
the preview instance would see a confusing half-completed session that they
couldn't do anything with.

## The fix

Immediately after the DB files are copied to `dstDb`, we open the copied file
with `bun:sqlite`, delete the row for `session.id` from `evolve_sessions`, and
close the handle. This runs before the `appendProgress` call that marks the
copy as done, so the child instance always starts with a clean session history
that contains only sessions that were fully completed before the snapshot was
taken.

The deletion is wrapped in a `try/catch` so a failure there is non-fatal — the
worst case is the child worktree shows the stale partial session, which is the
same behaviour as before this fix.

## Why this approach

The issue description offered two options:

1. **Hide/delete the session** from the copied DB after the copy.
2. **Copy the DB before creating the session** in the parent DB.

Option 2 would require creating the worktree directory in the POST route
(before the fire-and-forget `startLocalEvolve` call) so the destination path
exists at copy time, adding more restructuring for the same result. Option 1 is
a minimal, localised change with no impact on the main instance's session
lifecycle.
