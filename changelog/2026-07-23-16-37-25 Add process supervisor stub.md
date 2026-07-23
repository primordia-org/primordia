# Add process supervisor stub

Primordia now includes a small systemd-facing process supervisor. The supervisor starts both the reverse proxy and the scheduled jobs daemon, restarts either child if it exits unexpectedly, reloads both children when it receives `SIGHUP`, reloads only the reverse proxy when it receives `SIGUSR1`, and reloads only the scheduled jobs daemon when it receives `SIGUSR2`.

The installer now bundles and installs `process-supervisor.js` alongside `reverse-proxy.js`, points the `primordia` systemd unit at the supervisor, and uses the supervisor reload signal when supervised child code needs to be refreshed. Scheduled jobs now run as their own supervised `bun run primordia jobs run` process instead of being embedded inside the reverse proxy.

The CLI also gained targeted service restarts: `bun run primordia service reverse-proxy restart` and `bun run primordia service scheduled-jobs restart` signal the supervisor to restart just one child process.
