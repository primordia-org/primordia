# Why install.sh log streaming disconnects during deploy

When a thread is accepted into production, Primordia runs `scripts/install.sh` from `lib/threads.ts` via `runInstallSh()`. The script's stdout and stderr are captured by the running Next.js server process and appended to the thread session event log as `log_line` events.

The observed disconnect happens on the install script's restart path, immediately after:

```text
✓ Production branch published
```

At that point `scripts/install.sh` executes:

```bash
sudo systemctl restart --quiet primordia
```

The `primordia` systemd service is the reverse proxy service. Restarting it drops the HTTP connection that is currently carrying `/api/thread/stream` Server-Sent Events from the thread page to the browser. The endpoint does not intentionally close because the thread is complete; the socket is severed by the proxy service restart. The next line:

```text
✓ Restarted primordia systemd service
```

is written after the restart command returns, so the browser often misses it live.

## Does the client auto-reconnect?

Yes. The thread viewer now reconnects for this disconnect path.

`app/thread/[id]/ThreadView.tsx` uses `fetch()` plus `ReadableStream.getReader()` for the SSE stream, not the browser's `EventSource` API. `startStreaming()` is called on page mount, after explicit thread actions, and when the tab becomes visible again if the status is not terminal. It also schedules a short retry when the reader ends without an endpoint `done` event or throws a non-abort network error.

The reconnect uses the last received NDJSON line offset (`lineCountRef.current`) in `/api/thread/stream?offset=...`, so output already delivered is not duplicated and output written while the proxy was restarting is replayed when the service comes back. Retries stop once the session reaches a terminal `accepted` or `rejected` status, or when a newer stream run replaces the old one.

Reloading the thread page still opens a fresh connection through the restarted proxy and replays the already-persisted session events, but it should no longer be required for this install-stream gap.

## Where the log is stored

The live thread/install log is stored in the thread worktree as:

```text
{worktreePath}/.primordia-session.ndjson
```

Each install output chunk is persisted as a `log_line` event in that NDJSON file. The stream endpoint reads that file and sends events newer than the browser's current line offset.

If a thread worktree is later removed through cleanup/reject paths, Primordia archives the NDJSON file as a gzipped copy under:

```text
${PRIMORDIA_DIR}/past-sessions/*.ndjson.gz
```
