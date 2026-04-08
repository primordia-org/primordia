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
