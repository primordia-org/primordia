# Fix install log stream reconnect

Documented why the live thread log stream can disconnect while `install.sh` is accepting a production thread. The disconnect happens when the install script restarts the `primordia` systemd reverse-proxy service after publishing the production branch, which severs the SSE connection carrying `/api/thread/stream`.

Fixed the thread viewer so this disconnect path reconnects automatically. The fetch-based stream reader now schedules a short retry when the stream closes without an endpoint `done` event or hits a non-abort network error, reconnecting from the last received NDJSON line offset so install output is not duplicated or skipped.

Also documented where the install log is stored: live output is appended as `log_line` events to the thread worktree's `.primordia-session.ndjson`, with deleted session logs archived under `${PRIMORDIA_DIR}/past-sessions/` when applicable.
