# Add "Delete merged branches" button to the branches page

## What changed

- **New API route** `app/api/prune-branches/route.ts`: POST endpoint that runs `git branch --merged main`, filters out `main` itself, then deletes each merged branch with `git branch -d`. All output is streamed back as Server-Sent Events (same SSE format as `/api/git-sync`).
- **New component** `components/PruneBranchesDialog.tsx`: modal dialog modelled after `GitSyncDialog` — shows a confirmation screen before acting, then streams the live git output into a scrollable log box, and finishes with a success or error badge.
- **New component** `components/PruneBranchesButton.tsx`: thin client-side wrapper that renders the "Delete merged" button and mounts the dialog on click. Kept separate so the branches page can remain a Server Component and only this small piece opts into `"use client"`.
- **Updated** `app/branches/page.tsx`: imports `PruneBranchesButton` and renders it in a new actions row below the nav bar.

## Why

Merged (or externally-created) branches can accumulate over time even though the local evolve flow tries to clean up after itself — e.g. when a session errors out, a worktree is forcibly removed, or a branch was created by another tool. The new button gives developers a one-click way to sweep away those stale branches without having to drop to the terminal.
