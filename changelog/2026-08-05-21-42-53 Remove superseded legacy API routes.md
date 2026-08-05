# Remove superseded legacy API routes

Deleted old `/api/thread` and `/api/server` compatibility routes that had already been replaced by Primordia Core route-action endpoints. Thread creation, follow-ups, accept/reject, session log streaming, and preview server restart/log operations now rely on `/api/core` instead of duplicate legacy handlers.

Updated route architecture notes and stale documentation references so future work points at the Core API surface rather than removed endpoints.

Follow-up audit: reviewed every remaining `/api/thread` route and confirmed each is still called by first-party UI code. The route notes now document those current callers so future cleanup can distinguish still-active support endpoints from Core-superseded compatibility routes.
