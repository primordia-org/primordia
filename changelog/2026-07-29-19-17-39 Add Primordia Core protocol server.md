# Add Primordia Core protocol server

Resumed the archived `bidi-server-protocol` thread work by adding a small Primordia Core protocol server on top of the existing CLI command definitions.

- Added protocol metadata to the tiny CLI command model so runnable commands can be listed as stable Core methods.
- Added `bun run primordia core serve` to expose the command schema over HTTP and run commands through JSON RPC.
- Replaced the initial WebSocket transport with a simpler POST + Server-Sent Events flow: `POST /runs` starts a command, `GET /runs/:id/events` streams stdout/stderr/exit events, and `POST /runs/:id/abort` stops an active run.
- Core protocol requests now authenticate with revokable `web` API keys from Settings → API Keys and pass the resolved user/AES context into CLI-backed thread commands internally.
- Added `/test-pages/core-api-test` so developers can paste a web API key, load the Core schema, and exercise buffered or streaming Core calls from the browser.

This gives non-Next.js clients a first protocol surface for interacting with Primordia Core without duplicating command behavior.
