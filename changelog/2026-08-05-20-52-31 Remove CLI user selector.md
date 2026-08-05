# Remove CLI user selector

Removed the `--user` option from Primordia CLI and Core command definitions so user-scoped commands derive their user identity only from the authenticated Primordia API key.

This prevents callers from providing a user selector that conflicts with the API key owner. Thread creation, follow-ups, updates, accepts, rejects, and preference commands now resolve the acting user directly from the presented Primordia API key, and preset completion uses that authenticated identity for custom presets. The public environment variable is now `PRIMORDIA_API_KEY`; Core API requests validate that the Bearer key is a `web` key for the logged-in user before passing it through the same resolver, while the terminal CLI validates that the provided key is a `cli` key before running commands.
