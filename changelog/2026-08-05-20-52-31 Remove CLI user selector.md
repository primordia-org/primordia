# Remove CLI user selector

Removed the `--user` option from Primordia CLI and Core command definitions so user-scoped commands derive their user identity only from the authenticated Primordia API key.

This prevents callers from providing a user selector that conflicts with the API key owner. Thread creation, follow-ups, updates, accepts, rejects, and preference commands now resolve the acting user directly from the presented Primordia API key, and preset completion uses that authenticated identity for custom presets. Core API execution passes the web API key through the same resolver instead of carrying a separate `PRIMORDIA_CORE_USER_ID` environment value.
