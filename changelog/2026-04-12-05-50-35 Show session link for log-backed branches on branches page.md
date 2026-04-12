# Show session link for log-backed branches on branches page

## What changed

On the branches page, branches that have no DB session record but do have a
git-config `sessionId` pointing to a worktree with an NDJSON log now show a
`session ↗` link instead of the `+ session` button.

Previously, the `session ↗` link was only rendered when a session existed in
the local SQLite database. Branches whose sessions were created in a parent or
sibling worktree (and therefore not copied into the local DB) showed the
`+ session` button, which would start a brand-new session rather than linking
to the existing one.

## How it works

In `getBranchData()` (`app/branches/page.tsx`), for each branch that has no
DB session, we now:

1. Read `branch.<name>.sessionId` from git config (written by the evolve flow
   when a worktree is created).
2. Derive the candidate worktree path via `getCandidateWorktreePath(sessionId)`
   (the same sibling-directory convention used by the session page fallback).
3. Check whether `.primordia-session.ndjson` exists at that path.
4. If it does, populate `sessionId` on the branch data, which causes the
   existing `session ↗` link in `BranchRow` to render.

## Why

The `+ session` button for these branches was misleading — there was already a
session (and its log) for that branch; users needed a way to navigate to it
without being prompted to create a duplicate.
