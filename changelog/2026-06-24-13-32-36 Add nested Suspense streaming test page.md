# Add nested Suspense streaming test page

Added a developer test page at `/test-pages/nested-suspense-stream` that demonstrates streaming text lines with nested React Suspense boundaries in async Server Components.

The page now follows the interactive style of the ANSI streaming test page: users can customize the source text, choose how many generated log lines to stream, and set the per-line delay before starting a new server-rendered stream. The output is styled after the Server Logs section in the evolve Web Preview card, with a collapsible green-bordered log panel and monospaced streamed lines.

The test cycles through the custom source text and supports `{n}` / `{000}` placeholders so a short input can produce an arbitrary amount of streamed output. Each generated line is delayed behind nested Suspense boundaries, so the browser receives progressively streamed HTML without Server-Sent Events, polling, route handlers, or client-side fetch streaming.
