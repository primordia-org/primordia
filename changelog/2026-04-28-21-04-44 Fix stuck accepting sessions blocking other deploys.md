# Fix Stuck `accepting` Sessions Blocking Other Deploys

## Problem

When the server process is killed or crashes **during** an accept pipeline (between writing the `section_start:deploy` event and writing the final `result` event), the session's NDJSON log is left with no terminal event after the deploy section. `inferStatusFromEvents` then permanently infers `status = 'accepting'` for that session.

Gate 3 in `/api/evolve/manage` prevents any other session from being accepted while any session has `status === 'accepting'` (to prevent two concurrent deploys racing). This meant a single crash during an accept permanently blocked all future deploys until the server was manually manipulated or the NDJSON file edited by hand.

The user reported session `update-source-scheduling` was stuck in `accepting`, blocking session `post-body-params-docs-failure` from being deployed to production.

## Fix

### New endpoint: `POST /api/evolve/reset-stuck`

Writes a `result:error` event to the stuck session's NDJSON file, which causes `inferStatusFromEvents` to return `'ready'` instead of `'accepting'` or `'fixing-types'`. Requires `can_evolve` or `admin` permission.

Returns `409` if the session is not in a stuck state (not `accepting` or `fixing-types`), so it cannot be used to skip a legitimate in-progress deploy.

### UI: Force Reset button

When a session's status is `accepting` or `fixing-types`, a **Force Reset** button now appears in the Available Actions bar (visible to users with `can_evolve` permission). Clicking it calls the new endpoint and returns the session to `ready` state.

### UI: Link to stuck session from 409 error

When accepting a session returns a `409 Conflict` (another deploy in progress), the API now includes `stuckSessionId` and `stuckSessionBranch` in the response body. The error message in the Accept panel now shows:
- A link to navigate directly to the stuck session's page
- A **Force Reset stuck session** button that resets the blocking session without leaving the current page

This allows the user to unblock themselves from any session page without needing to know which session is stuck or manually navigating to it.
