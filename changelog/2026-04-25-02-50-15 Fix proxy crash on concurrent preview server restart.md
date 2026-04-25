# Fix proxy crash on concurrent preview server restart

## What changed

Three race-condition fixes in `scripts/reverse-proxy.ts` to prevent the reverse
proxy from crashing or becoming unavailable when a preview server restart is
triggered while another restart is already in progress.

### Bug 1 — Orphaned process from concurrent restarts

`startPreviewServer` is `async` and calls `await killPortOwner(port)`, which
polls up to 60 s for the port to become free. If a second restart request
arrives during that poll window, `stopPreviewServer` is called again on the
same session. At that point `entry.process` is still `null` (the child hasn't
been spawned yet), so `stopPreviewServer` marks the entry as `stopped` and
removes it from the `previewProcesses` map. When `killPortOwner` eventually
returns, `startPreviewServer` spawns the child process anyway and assigns it
to the now-removed entry — creating an **orphaned process** that nothing in
the proxy tracks or manages. Future operations on the same port (e.g. a
subsequent restart, or a production server spawn via `killPortOwner`) could
then interact with this orphan in unpredictable ways.

**Fix**: After `await killPortOwner`, check whether our entry is still the
active one in `previewProcesses`. If another operation has replaced or
removed it, log a message and return early without spawning.

### Bug 2 — TypeError when stopping a not-yet-spawned entry

When `stopPreviewServer` is called while `entry.process` is still `null`
(typed as `null as unknown as ChildProcess`), accessing `entry.process.pid`
throws a `TypeError`. The `catch` block then tries `entry.process.kill(...)`,
which throws another `TypeError`. Both are silently swallowed, but the
pattern is fragile and could mask real errors in future.

**Fix**: Add an explicit `if (entry.process == null) return;` guard
immediately after removing the entry from the map, before any kill attempt.

### Bug 3 — Double-restart race in the restart API handler

`POST /_proxy/preview/:id/restart` called `stopPreviewServer` then
`void startPreviewServer(...)` with no protection against concurrent
identical requests. If the user (or client code) triggered two rapid restarts,
both could enter `startPreviewServer` simultaneously for the same session and
port, leading to the orphaned-process scenario above.

**Fix**: At the top of the restart handler, check whether the entry is
already `'starting'`. If so, return `200 { ok: true, note: 'already starting' }`
immediately (idempotent) without starting a second concurrent spawn.

### Bonus — Production-port guard in restart handler

`handlePreviewRequest` already refuses to launch a dev server for a session
whose port equals `upstreamPort` (i.e. the session was just accepted into
production). The restart handler lacked this same guard, meaning calling
restart on a just-accepted session would invoke `killPortOwner(upstreamPort)`
and terminate the production server.

**Fix**: Added the same `info.port === upstreamPort` check to the restart
handler, returning `409` with a descriptive error.

## Why

The proxy was becoming unavailable on port 8000 after certain preview server
restarts. Systemd logs showed `(code unknown)` exit events (SIGTERM'd processes)
followed by a second unexpected "stopping preview server" log, indicating
a concurrent `stopPreviewServer` call during the `killPortOwner` polling
window. The orphaned processes and undefined entry state that resulted from
this race were the most likely cause of the instability.
