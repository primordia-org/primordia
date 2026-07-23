# Document install log stream disconnect

Documented why the live thread log stream can disconnect while `install.sh` is accepting a production thread. The disconnect happens when the install script restarts the `primordia` systemd reverse-proxy service after publishing the production branch, which severs the SSE connection carrying `/api/thread/stream`.

Also documented that the thread viewer does not auto-reconnect for this specific stream-close/error path. It starts streaming on mount, selected UI actions, and visibility changes while non-terminal, but a severed `fetch()`/reader stream simply exits without scheduling a retry.

Also documented where the install log is stored: live output is appended as `log_line` events to the thread worktree's `.primordia-session.ndjson`, with deleted session logs archived under `${PRIMORDIA_DIR}/past-sessions/` when applicable.
