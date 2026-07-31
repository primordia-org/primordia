# Restore lazy preview autostart

Preview requests now verify that a preview server marked as running is still reachable before forwarding traffic. If the dev server has died or been stopped, the reverse proxy marks it stopped, starts it again through the process manager, and queues the request until the server is ready.

This prevents stale preview registry entries from causing `/preview/<thread-id>` URLs to return an immediate Bad Gateway instead of lazily spawning the preview server again.
