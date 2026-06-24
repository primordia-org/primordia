# Add nested Suspense streaming test page

Added a developer test page at `/test-pages/nested-suspense-stream` that demonstrates streaming text lines with nested React Suspense boundaries in async Server Components.

The page follows the interactive style of the ANSI streaming test page: users can customize the source text, set the per-boundary delay, and restart a new server-rendered stream. The output is styled after the Server Logs section in the evolve Web Preview card, with a collapsible green-bordered log panel and monospaced streamed lines.

The test now models an unknown-length stream as a recursive Suspense tail: each boundary resolves to one rendered log line plus the next Suspense boundary. Pending boundaries render as empty space rather than numbered placeholders, so the UI behaves like an unbounded log stream instead of a pre-known list. A safety cap remains available only to keep the server-rendered demo finite. The stream cycles through custom source text and supports `{n}` / `{000}` placeholders while delivering progressively streamed HTML without Server-Sent Events, polling, route handlers, or client-side fetch streaming.
