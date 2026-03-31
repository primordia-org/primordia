# Remove message listener and restart route from AcceptRejectBar

## What changed

- **`components/AcceptRejectBar.tsx`**: Removed the `useEffect` that listened for `"primordia:preview-accepted"` postMessage events on the parent window. Also removed the now-unused `useEffect` import.
- **`app/api/evolve/restart/route.ts`** (entire file deleted): Removed the `/api/evolve/restart` POST route that ran `bun install` + `bun run predev` + called `/__nextjs_restart_dev` after a preview was accepted.
- **`PRIMORDIA.md`**: Removed the file-map entry for the deleted `restart/` route.

The `kill-restart` route (`app/api/evolve/kill-restart/`) is unchanged.

## Why

The restart route was designed to handle post-accept server reloading in the parent tab by receiving a cross-window postMessage from the closing preview. This mechanism is no longer needed — the responsibility for restarting has moved elsewhere (or the flow no longer requires an explicit restart step triggered from the browser). Removing both the listener and the dead route eliminates unnecessary complexity and a stale API surface.
