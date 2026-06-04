# Reconnect evolve workers on startup

Fixed a startup recovery gap that could leave evolve sessions permanently stuck in `[starting]` after the app server restarted during setup.

The recovery helper already knew how to scan session logs, reconnect live worker PIDs, and mark orphaned running sessions as ready, but the Next.js instrumentation hook was not actually calling it on server boot. The instrumentation hook now invokes `reconnectRunningWorkers()` alongside the existing background schedulers so sessions like `update-file-maps` can be recovered automatically instead of remaining in the setup state forever.

Updated the project file map note for `instrumentation.ts` to reflect that it now performs evolve worker/session recovery during server startup.
