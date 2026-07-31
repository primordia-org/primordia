# Use Core API for thread log streams

Thread detail pages now watch both the agent session log and preview server log through Primordia Core API log endpoints instead of the legacy thread/server log APIs.

The live log clients now pause their subscriptions when the page is hidden and reconnect when the page becomes visible again, using Core API `start` cursors so any log lines written while hidden are replayed without duplicating already-rendered output.
