# Show preview server logs on crash

## What changed

**`scripts/reverse-proxy.ts`**

- When the preview server process exits (crash or natural stop), the entry is no longer deleted from `previewProcesses`. The `logBuffer` is preserved so it can still be served via `/_proxy/preview/:id/logs` after the crash.
- The inactivity cleaner now also evicts stopped entries from the map once they exceed the 30-minute inactivity threshold, preventing memory leaks from accumulated crash entries.

**`components/EvolveSessionView.tsx`**

- The "Server logs" `<details>` section is now auto-expanded (`open`) when `proxyServerStatus === 'stopped'`, so crash logs are immediately visible without requiring a manual click.

## Why

Previously, when the dev server crashed:

1. `previewProcesses.delete(sessionId)` was called in the `close` handler, discarding the in-memory `logBuffer`.
2. Any subsequent request to `/_proxy/preview/:id/logs` found no entry and returned `done: true` immediately with no log content.
3. Even if logs had been streamed before the crash, the UI "Server logs" section was collapsed by default, so users had to know to look there.

Together these made it very hard to debug crashes — the logs were either gone or hidden.
