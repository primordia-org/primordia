# Add process supervisor stub

Primordia now includes a small systemd-facing process supervisor. The supervisor keeps both the reverse proxy and the scheduled jobs daemon alive as independent detached processes, restarts either service if it exits unexpectedly, checks both services when it receives `SIGHUP`, restarts only the reverse proxy when it receives `SIGUSR1`, and restarts only the scheduled jobs daemon when it receives `SIGUSR2`. Restarting the supervisor itself no longer stops or restarts either Primordia service.

The installer now bundles and installs three core launchers: `process-supervisor.js`, `reverse-proxy.js`, and `scheduled-jobs.js`. It points the `primordia` systemd unit at the supervisor, uses small Bash helper functions to install the systemd service and bundled Primordia services, and restarts changed child services through the Primordia CLI instead of signaling systemd directly. Scheduled jobs now run from the bundled `scheduled-jobs.js` entrypoint instead of being embedded inside the reverse proxy.

The CLI also gained targeted service restarts: `bun run primordia service process-supervisor restart`, `bun run primordia service reverse-proxy restart`, and `bun run primordia service scheduled-jobs restart` restart one core process at a time.
