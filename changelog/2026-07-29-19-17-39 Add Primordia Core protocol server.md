# Add Primordia Core route-action definitions

Resumed the archived `bidi-server-protocol` thread work by extending the existing CLI command definitions into a first Core API shape, without adding a separate CLI-hosted server.

- Added Core API metadata to the tiny CLI command model so runnable commands can declare route-action endpoints such as `POST /status`, `POST /server/[threadId]/logs`, and `POST /thread/[threadId]/followup`.
- Removed the experimental `bun run primordia core serve` command and the standalone Core protocol server; the CLI stays a CLI for now.
- Added an in-app `/api/core` route-action surface that reads the CLI definitions, authenticates callers with revokable `web` API keys from Settings → API Keys, runs commands through the existing CLI handlers, and passes resolved user/AES context into thread commands internally.
- Core actions accept JSON bodies and multipart form bodies. Form fields map to command arguments/options so thread create/follow-up endpoints can grow file attachment support naturally.
- Streaming commands, including log-style commands, stream plain text responses by default instead of requiring a second transport.
- Updated `/test-pages/core-api-test` so developers can paste a web API key, inspect generated Core API routes, and exercise buffered, streaming, JSON, or multipart POST action calls from the browser.

This gives non-Next.js clients a route-oriented Core API sketch while keeping behavior sourced from the same command definitions used by the CLI.
