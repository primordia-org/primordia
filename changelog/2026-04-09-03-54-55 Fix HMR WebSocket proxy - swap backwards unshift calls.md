# Fix HMR WebSocket proxy — swap backwards unshift calls

## What changed

Fixed two bugs in the WebSocket upgrade handler in `scripts/reverse-proxy.ts`.

### Bug 1: `unshift` calls had sockets swapped (root cause of broken HMR)

In the `server.on('upgrade', ...)` handler, after the upstream responds with `101 Switching Protocols`, two pieces of buffered data need to be injected into the bidirectional pipe:

- `upstreamHead` — data from the upstream (dev server) socket that was buffered alongside the 101 response headers (i.e. the first WebSocket frame(s) sent by the server).
- `head` — data from the client socket that was buffered alongside the HTTP upgrade request headers (i.e. the first WebSocket frame(s) sent by the browser).

The pipe is set up as:
```
upstreamSocket.pipe(clientSocket)  // upstream → browser
clientSocket.pipe(upstreamSocket)  // browser → upstream
```

So `upstreamHead` (data *from* upstream) must be unshifted into `upstreamSocket`'s readable side so it flows to the browser, and `head` (data *from* client) must be unshifted into `clientSocket`'s readable side so it flows to the upstream.

The original code had these backwards:
```ts
// BEFORE (wrong):
if (upstreamHead && upstreamHead.length > 0) clientSocket.unshift(upstreamHead);
if (head && head.length > 0) upstreamSocket.unshift(head);
```

This sent upstream-originated data back to the upstream, and client-originated data back to the client. When the dev server sends an initial HMR state message in the same TCP segment as the 101 headers (common), `upstreamHead` is non-empty and the message is looped back to the dev server instead of delivered to the browser. The browser never receives the initial HMR snapshot, so hot-reload never fires.

Fixed to:
```ts
// AFTER (correct):
if (upstreamHead && upstreamHead.length > 0) upstreamSocket.unshift(upstreamHead);
if (head && head.length > 0) clientSocket.unshift(head);
```

### Bug 2: missing `response` event handler on the upstream WebSocket request

If the upstream dev server responds with anything other than `101 Switching Protocols` (e.g. `400 Bad Request` when the path is wrong, or `404` when the server isn't ready), the `upgrade` event never fires. Without a `response` handler, Node.js would emit an unhandled-event warning and the client socket would hang open indefinitely.

Added a `response` handler that logs the unexpected status, drains the response body, writes an HTTP 502 back to the client socket, and destroys it cleanly.

## Why

HMR (Hot Module Replacement) was silently broken for all preview dev servers accessed through the reverse proxy. File changes made by Claude Code in a worktree would not hot-reload in the browser, forcing users to manually refresh the page to see updates. The root cause was the swapped `unshift` sockets described above.
