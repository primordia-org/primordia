# Fix WebSocket proxy 101 error in Bun

## What changed

In `scripts/reverse-proxy.ts`, the `response` event handler for upstream WebSocket upgrade requests now handles the case where the upstream returns HTTP 101 Switching Protocols via `response` instead of `upgrade`.

## Why

Bun's HTTP client fires the `response` event (rather than `upgrade`) when the upstream responds with `101 Switching Protocols`. The previous code treated any `response` event as a non-upgrade error, logging:

```
[proxy] WS upstream on port 3050 returned HTTP 101 instead of 101
```

...and then destroying the client socket with a 502, breaking all WebSocket connections (including Next.js HMR) through the preview proxy.

## Fix

Added a check at the top of the `response` handler: if `statusCode === 101`, forward the upgrade to the client using the same logic as the `upgrade` event handler — write the 101 response headers to the client socket, then pipe `upstreamRes` (which carries the raw WebSocket frames) to `clientSocket` and `clientSocket` to `upstreamRes.socket` for bidirectional tunnelling.

## Upstream status (as of 2026-04-09)

This is a confirmed Bun bug. Bun's `node:http` `ClientRequest` fires `'response'` instead of `'upgrade'` when an upstream returns `101 Switching Protocols`, contrary to Node.js behavior.

- **Issue:** [oven-sh/bun#29012](https://github.com/oven-sh/bun/issues/29012) — filed 2026-04-08, open
- **Fix PR:** [oven-sh/bun#29015](https://github.com/oven-sh/bun/pull/29015) — filed 2026-04-08, not yet merged
- **Latest released Bun:** v1.3.11 (2026-03-18) — does not include the fix

Our workaround remains necessary until Bun PR #29015 lands in a release. Once it does, the `response`-event 101 fallback in `scripts/reverse-proxy.ts` can be removed (the `upgrade` event will fire correctly).
