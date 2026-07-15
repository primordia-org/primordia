# Clarify revoked CLI key errors

Revoking a Primordia CLI key now preserves the key record, clears the stored encrypted AES wrapper secret, and records when the key was revoked. This lets the CLI distinguish a genuinely unknown `PRIMORDIA_CLI_KEY` from one that was intentionally revoked and show a more helpful error.

The Settings → Primordia CLI page now shows revoked keys with a revoked status instead of removing them from history, and revoked keys can no longer be extended.
