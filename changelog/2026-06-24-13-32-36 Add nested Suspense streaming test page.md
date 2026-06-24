# Add nested Suspense streaming test page

Added a developer test page at `/test-pages/nested-suspense-stream` that demonstrates streaming text lines with a recursive React Suspense tail in async Server Components.

The page follows the interactive style of the ANSI streaming test page: users can choose between multiple representative Next.js server-log demos, see the selected demo text in an editable textbox, customize the text, set the per-line delay, and restart a new server-rendered stream. The output is styled after the Server Logs section in the evolve Web Preview card, with a collapsible green-bordered log panel and monospaced streamed lines.

Each Suspense boundary resolves to exactly one ANSI-rendered log line plus the next Suspense boundary. Pending boundaries render as empty space, so the UI behaves like an unknown-length log stream instead of a pre-known list. The stream stops when it reaches the end of the provided text and delivers progressively streamed HTML without Server-Sent Events, polling, route handlers, or client-side fetch streaming.
