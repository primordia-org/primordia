# Simplify evolve secret handling

Evolve requests now send the browser's existing `primordia_aes_key` to the server instead of decrypting stored secrets in the browser and re-wrapping them for transit. The server looks up the selected encrypted secret from SQLite and passes the AES key to detached workers through a single `PRIMORDIA_AES_KEY` environment variable.

Workers decrypt only the selected secret they need from their encrypted config payload, replacing the previous set of per-secret environment variables (`PRIMORDIA_USER_API_KEY`, `PRIMORDIA_USER_CREDENTIALS`, `PRIMORDIA_CHATGPT_OAUTH`, and `PRIMORDIA_REQUIRED_AUTH_SOURCE`). This keeps secrets encrypted at rest while making the worker/CLI interface much simpler for future evolve entry points.

The landing page copy was also updated to explain the behavior without implementation details: credentials are decrypted right before use and deleted immediately after. Base64 decoding now uses the native ES2025 `Uint8Array.fromBase64()` API instead of custom conversion helpers, and worker secret decryption now uses `crypto.subtle` instead of Node's `crypto` library so browser/server/worker paths share the same Web Crypto approach.

The CLI path now uses revokable wrapper keys instead of exposing the raw AES key. `/settings/cli` can list, create, revoke, and extend expiring CLI keys; newly-created keys are shown once as `PRIMORDIA_CLI_KEY=v1.<short-id>.<alg>.<k>`. The terminal CLI resolves `PRIMORDIA_CLI_KEY` back into the internal worker AES key before starting secret-backed create/follow-up/accept flows.
