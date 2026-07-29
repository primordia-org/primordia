# Rename CLI settings to API keys

Renamed the Primordia CLI settings page and navigation entry to **API keys** at `/settings/api-keys`.

The page now uses the settings append-list pattern to add API keys for either a CLI or web client. The API-key endpoint persists the selected `client` value, lists both client types together, and permits either type to be extended or revoked. CLI keys continue to provide a copyable `PRIMORDIA_CLI_KEY` export command.
