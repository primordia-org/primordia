# Remove CLI user selector

Removed the `--user` option from Primordia CLI and Core command definitions so user-scoped commands derive their user identity only from the authenticated Primordia API key.

This prevents callers from providing a user selector that conflicts with the API key owner. Thread creation, follow-ups, updates, accepts, rejects, and preference commands now resolve the acting user from `PRIMORDIA_CLI_KEY` (or the Core web API key in API execution), and preset completion uses that authenticated identity for custom presets.
