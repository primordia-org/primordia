# Make branches and sessions pages publicly viewable

## What changed

- **Branches link always visible**: The "Branches" nav link in `NavHeader` was previously hidden except in development mode (`NODE_ENV === "development"`). It now appears in all environments, next to the Changelog link.

- **Branches page is now public**: `/branches` no longer requires login or admin access. Anyone can view the git branch tree and session status list. Admin-only elements (the Prune Branches button and the Diagnostics panel) are conditionally rendered — they still only appear for admins.

- **Session page is now public**: `/evolve/session/[id]` no longer redirects unauthenticated users to `/login`. Anyone can view the session progress log, branch name, and current status.

- **Session actions hidden for non-evolvers**: The following interactive elements are hidden for users who do not have the `can_evolve` (or `admin`) permission:
  - "Available Actions" panel (Follow-up, Accept, Reject buttons)
  - Abort button
  - Upstream Changes section (Merge / Rebase buttons)
  - Error-state follow-up form and Restart dev server button
  - Disconnected-state Restart dev server button
  - "Submit another request" footer link
  - Branches link in session footer was also de-gated from dev-only

## Why

The branches and sessions pages are informational — they let observers watch what's happening in the system (which branches exist, what Claude is doing, what progress looks like). There's no reason to hide this from the public. The actions that mutate state (accept, reject, follow-up, abort, merge/rebase) are still gated on the `can_evolve` permission, so security is unchanged.
