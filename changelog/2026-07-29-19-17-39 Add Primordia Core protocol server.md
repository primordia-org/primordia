# Add Primordia Core protocol server

Resumed the archived `bidi-server-protocol` thread work by adding a small Primordia Core protocol server on top of the existing CLI command definitions.

- Added protocol metadata to the tiny CLI command model so runnable commands can be listed as stable Core methods.
- Added `bun run primordia core serve` to expose the command schema over HTTP and run commands through JSON RPC.
- Added WebSocket `/rpc` support for streaming stdout/stderr from long-running commands and aborting active runs.

This gives non-Next.js clients a first protocol surface for interacting with Primordia Core without duplicating command behavior.
