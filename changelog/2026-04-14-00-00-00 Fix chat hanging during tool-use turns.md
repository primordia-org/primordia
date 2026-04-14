# Fix chat hanging during tool-use turns

## What changed

### `app/api/chat/route.ts`
Added a `keepAlive()` helper that sends an SSE comment line (`: ping\n\n`) to the client. It is called twice per agentic tool-use iteration:
1. Immediately after the streaming turn finishes and tool use is detected (before tool execution).
2. After tool execution completes (before the follow-up API call).

SSE comment lines are part of the SSE spec and are safely ignored by all SSE parsers — the client receives them as a "data is coming, please stay connected" signal without any visible effect.

### `components/ChatInterface.tsx`
Replaced the `break` inside the inner `for` loop (which only exited the line-parsing loop, not the outer reader loop) with a `streamDone` flag that causes the outer `while` loop to exit cleanly as soon as `[DONE]` is seen.

Also tightened the line-parsing logic to use `continue` instead of a nested `if`, making the intent clearer.

## Why

The chat was hanging (visible as a frozen "Let me check the relevant…" bubble) after the first streaming token was delivered.

The root cause was **two compounding issues**:

1. **Proxy idle-timeout on the server side.** When Claude decides to use a tool (e.g. `read_file`, `list_directory`), the SSE response stream goes completely silent while the server executes the tools and issues a second Anthropic API call. This silence can last 30–120 seconds. Many reverse proxies (including the exe.dev proxy) close connections that carry no data for ~60–100 seconds, silently killing the stream. The client then waited until its own TCP stack detected the dead connection (another 30–60 s), resulting in a ~1.66-minute hang with only the partial first chunk ever displayed. Adding the keep-alive ping comments prevents the proxy from treating the connection as idle.

2. **Client `[DONE]` break only exited the inner loop.** After receiving `[DONE]`, the `break` statement only left the `for (const line of lines)` loop. The outer `while (true)` loop then called `reader.read()` again. If the stream was not yet fully closed from the browser's perspective (e.g. HTTP keep-alive), this caused the client to hang indefinitely waiting for a byte that would never arrive. The `streamDone` flag fixes this by exiting the outer loop immediately on `[DONE]`.
