# Use Core API for thread log streams

Thread detail pages now watch both the agent session log and preview server log through Primordia Core API log endpoints instead of the legacy thread/server log APIs.

The thread detail server page is now only a lightweight shell. The client loads thread metadata, preferences, and log content through Primordia Core so browser code no longer imports filesystem/git helpers such as `lib/session-events.ts` at runtime.

The live log clients now pause their subscriptions when the page is hidden and reconnect when the page becomes visible again, using Core API `start` cursors so any log lines written while hidden are replayed without duplicating already-rendered output.

If a browser's stored Core web API key was revoked or disappeared from the server, Core requests now clear the stale local key, create a replacement, and retry once. Thread pages also show explicit Core load errors instead of leaving users stuck on the default loading placeholder.

Preview server logs request Core's machine log stream but render each event's `.line` value, so the UI shows the actual log output rather than raw NDJSON wrapper objects. The reusable log viewer was renamed to match its Core streaming behavior, wraps long log lines within its parent container, and only connects when the Server logs details panel is open. The Server logs header now includes a Pause/Follow Logs toggle, and following mode keeps the log scrolled to the bottom as new output arrives unless the user has scrolled upward.
