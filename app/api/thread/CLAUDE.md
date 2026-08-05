# Thread API — Architecture Reference

This directory contains thread and agent-run endpoints. Process-management endpoints that restart preview servers, stream preview logs, or hot-swap preview SQLite DB files live in `app/api/server/`.

## Endpoint map

- `abort/route.ts` — stops the active agent run and moves the thread back to ready; used by the thread detail page abort control.
- `upstream-sync/route.ts` — merges parent/prod updates into a thread worktree and coordinates preview DB hotswap through `/api/server/hotswap-db`; used by the thread detail page Apply Updates control.
- `reset-stuck/route.ts` — force-resets threads stuck in accepting/fixing-types; used by the thread detail page stuck-session recovery control.
- `from-branch/route.ts` — attaches thread tracking and preview machinery to an existing local branch; used by the branch tree page's "+ thread" action.
- `diff/route.ts` and `diff-summary/route.ts` — expose thread-vs-parent diffs; used by the thread detail page's Files changed panel.
- `attachment/[threadId]/route.ts` — serves files from a thread worktree's `attachments/` directory; used by thread markdown/image rendering.
- `models/route.ts`, `presets/route.ts`, `sessions/route.ts` — support thread creation UI data, preset availability, and the updates bell's active-thread list.

These remaining `/api/thread` routes are still called by first-party UI code. Thread creation, follow-up requests, accept/reject, session log streaming, and preview server lifecycle/log operations are exposed through `/api/core` route-action endpoints instead of legacy `/api/thread` or `/api/server` compatibility routes.

## Thread state

Thread status is inferred from the append-only `.primordia-session.ndjson` log in the worktree. Key statuses are `starting`, `running-claude`, `fixing-types`, `ready`, `accepting`, `accepted`, and `rejected`. Preview server state is tracked separately as `none`, `starting`, `running`, or `disconnected`.

The standalone thread creation page is `/thread`, and public thread detail pages are `/thread/[id]`; do not add compatibility routes for retired thread or branch-page URLs.
