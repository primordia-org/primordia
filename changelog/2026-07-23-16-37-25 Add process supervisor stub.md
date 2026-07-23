# Add process supervisor stub

Primordia now includes a small systemd-facing process supervisor. The supervisor starts both the reverse proxy and the scheduled jobs daemon, restarts either child if it exits unexpectedly, and reloads both children when it receives `SIGHUP` or `SIGUSR2` after code changes.

The installer now bundles and installs `process-supervisor.js` alongside `reverse-proxy.js`, points the `primordia` systemd unit at the supervisor, and uses the supervisor reload signal when only supervised child code needs to be refreshed. Scheduled jobs now run as their own supervised `bun run primordia jobs run` process instead of being embedded inside the reverse proxy.
