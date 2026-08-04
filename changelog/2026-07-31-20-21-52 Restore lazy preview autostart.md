# Restore lazy preview autostart

Preview requests now verify that a preview server marked as running is still reachable before forwarding traffic. If the dev server has died or been stopped, the reverse proxy marks it stopped, starts it again through the process manager, and queues the request until the server is ready.

Production now gets the same protection even when there is no active user request: the reverse proxy runs a background health check, restarts the production app server when its port stops answering, and sends admins subscribed to Server Health Alerts a web push notification when production goes down or recovers. Server logs also include process-manager lifecycle annotations for explicit graceful stops, forced kills, launches, and command exit statuses so future downtime can be classified from the log instead of inferred from absence.

This prevents stale preview registry entries and dead production app servers from causing `/preview/<thread-id>` URLs or the main site to return an immediate Bad Gateway instead of spawning the server again.
