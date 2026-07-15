# Use Bun types for Base64 helpers

Confirmed that the type checker still needs declarations for `Uint8Array.fromBase64()` when the local ambient helpers are removed: without replacement types, `tsc --noEmit` reports missing `fromBase64` in the server and worker secret decryption helpers.

Replaced the hand-written `bun.d.ts` ambient declarations with the official Bun type package. `@types/bun`/`bun-types` provide the Bun runtime declarations, including the ES2025 Base64 typed-array helpers, so the project no longer has to maintain a custom copy of those interfaces. The SQLite adapter now uses Bun's exported `SQLQueryBindings` type for dynamic query parameter arrays so it type-checks against the official `bun:sqlite` definitions.
