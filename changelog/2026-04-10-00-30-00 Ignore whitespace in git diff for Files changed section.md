# Ignore whitespace in git diff for Files changed section

## What changed

Added the `-w` flag (ignore all whitespace) to both git diff invocations used in the "Files changed" section of the evolve session page:

- `app/evolve/session/[id]/page.tsx` — `getGitDiffSummary()` now runs `git diff --numstat -w parent...sessionBranch` so the per-file additions/deletions count ignores whitespace-only changes.
- `app/api/evolve/diff/route.ts` — the per-file diff API now runs `git diff -w parent...sessionBranch -- <file>` so the expanded unified diff shown when a user clicks a file also ignores whitespace.

## Why

Whitespace-only changes (indentation reformatting, trailing space cleanup, blank line tweaks) inflate the diff summary and clutter the per-file diff view without conveying meaningful code intent. Ignoring them gives a cleaner, more accurate picture of what actually changed.
