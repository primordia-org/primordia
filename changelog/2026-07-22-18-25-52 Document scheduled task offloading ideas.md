# Document scheduled task offloading ideas

Added a design note in `docs/scheduled-task-offloading-ideas.md` that inventories Primordia's current scheduled jobs and brainstorms ways to move that work out of the Next.js app lifecycle.

The document compares daemon-based CLI jobs, systemd timers, a SQLite-backed job queue, proxy-embedded migration bridges, external schedulers, and a future Core supervisor. It also recommends a practical path toward `primordia jobs` commands, scheduler locking, dedicated production job services, and shared Core job definitions.
