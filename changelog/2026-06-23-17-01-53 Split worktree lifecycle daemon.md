# Split worktree lifecycle daemon

Separated Primordia's public reverse proxy from worktree session lifecycle management.

- Replaced `scripts/reverse-proxy.ts` with a smaller traffic-only proxy that forwards production and preview requests and delegates `/_proxy/*` lifecycle APIs to a local daemon socket.
- Added `scripts/worktree-session-daemon.ts` to own production/preview server spawning, preview restarts, log streaming, deploy slot activation, and disk cleanup.
- Added a `worktree-daemon` package script and updated `install.sh` to install/copy the daemon and run it as its own systemd service beside the reverse proxy.

This keeps the reverse proxy stable and focused on routing, so future worktree lifecycle changes can be made in the daemon without touching the public proxy layer.
