# Restore lazy preview autostart

Preview requests now verify that a preview server marked as running is still reachable before forwarding traffic. If the dev server has died or been stopped, the reverse proxy marks it stopped, starts it again through the process manager, and queues the request until the server is ready.

Production now gets the same protection even when there is no active user request: the reverse proxy runs a background health check, restarts the production app server when its port stops answering, and sends admins subscribed to Server Health Alerts a web push notification when production goes down or recovers. Server logs also include process-manager lifecycle annotations for explicit graceful stops, forced kills, launches, and command exit statuses so future downtime can be classified from the log instead of inferred from absence.

The Server Health admin page now shows recent kernel OOM-kill events from `journalctl`/`dmesg`, including the killed process, PID, memory cgroup, and RSS. Leak diagnostics captures also include recent OOM lines so SIGKILLs caused by global memory pressure are visible in-app instead of requiring shell access.

This prevents stale preview registry entries and dead production app servers from causing `/preview/<thread-id>` URLs or the main site to return an immediate Bad Gateway instead of spawning the server again, and makes OOM-driven restarts explainable after the fact.
