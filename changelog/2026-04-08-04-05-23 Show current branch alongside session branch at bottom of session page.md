# Show current branch alongside session branch at bottom of session page

## What changed

The footer of the evolve session page (`/evolve/session/[id]`) previously showed only the session (evolve) branch name. It now also shows the current checked-out branch name, separated by a right-facing triangle (`▸`), in the format:

```
currentBranch ▸ sessionBranch
```

If the current branch cannot be determined (null), only the session branch name is shown (no change from before).

On small screens the branch names now stack below the Changelog · Branches links rather than sitting side by side, preventing the two from colliding on narrow viewports.

## Why

This makes it easy to see at a glance both which branch the session was created from and what the session's own branch name is, without having to navigate away from the page. The responsive stacking prevents layout overflow on mobile.

---

# Show production-specific accept confirmation text on session page

## What changed

The Accept confirmation panel in `EvolveSessionView` now shows different copy depending on whether the server is running in production mode (`NODE_ENV=production`).

**Development (local):** unchanged — "Accepting will merge the preview branch `{sessionBranch}` into `{parentBranch}`."

**Production (blue/green):** "Accepting will make the current preview branch `{sessionBranch}` the new production instance. The `{parentBranch}` branch will remain on the commit it is at and its worktree will remain available for future rollbacks. The `main` branch will be updated, and the `PROD` symbolic-ref will be set to `refs/heads/{sessionBranch}`."

A new `isProduction: boolean` prop was added to `EvolveSessionViewProps`; the session page (`app/evolve/session/[id]/page.tsx`) passes `process.env.NODE_ENV === "production"` for it.

## Why

In production, accepting a preview does not merge the branch into the parent in the traditional sense — it performs a zero-downtime blue/green cutover where the preview worktree becomes the live production slot. The old copy ("merge … into …") was both technically inaccurate and missing important context about what happens to the old slot, `main`, and `PROD`. The new copy explains the actual production behavior clearly.
