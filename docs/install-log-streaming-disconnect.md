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

Not for this disconnect path.

`app/thread/[id]/ThreadView.tsx` uses `fetch()` plus `ReadableStream.getReader()` for the SSE stream, not the browser's `EventSource` API. `startStreaming()` is called on page mount, after explicit thread actions, and when the tab becomes visible again if the status is not terminal. However, when `reader.read()` returns `done` or throws a non-abort network error, the function simply exits and leaves the UI in its last known state. There is no retry loop, backoff, or immediate reconnect scheduled from the stream-close/error path itself.

That means the proxy restart can kill the live stream and the thread viewer will not automatically reconnect unless another trigger happens later, such as a page reload, visibility-change reconnect while the thread is still non-terminal, or another explicit action that calls `startStreaming()`.

Reloading the thread page opens a fresh connection through the restarted proxy and replays the already-persisted session events, which is why the full install log is visible after refresh.

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
