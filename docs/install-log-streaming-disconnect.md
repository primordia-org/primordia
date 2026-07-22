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

is written after the restart command returns, so the browser often misses it live. Reloading the thread page opens a fresh connection through the restarted proxy and replays the already-persisted session events, which is why the full install log is visible after refresh.

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
