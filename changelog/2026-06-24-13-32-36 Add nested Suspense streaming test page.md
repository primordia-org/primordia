# Add nested Suspense streaming test page

Added a developer test page at `/test-pages/nested-suspense-stream` that demonstrates streaming text lines with a recursive React Suspense tail in async Server Components.

The page follows the interactive style of the ANSI streaming test page: users can choose between multiple representative Next.js server-log demos, see the selected demo text in an editable textbox, customize the text, set the per-line delay, and restart a new server-rendered stream. The demo writes the selected text into a temporary log file line by line so the streamed UI is driven by real file updates.

The recursive Suspense tail is now available as a reusable server component, `<SuspenseLogFile logFilename="..." />`, which watches a log file and renders each appended line with the ANSI renderer. Each Suspense boundary resolves to exactly one ANSI-rendered log line plus the next Suspense boundary. Pending boundaries render as empty space, so the UI behaves like an unknown-length log stream instead of a pre-known list, and it delivers progressively streamed HTML without Server-Sent Events, polling route handlers, or client-side fetch streaming.

Also hardened the evolve preview panel against simple self-recursion: if the iframe resolves to the same pathname as the session page itself, the panel shows a calm “Preview hidden to prevent infinitely nested previews” message with a neutral stop-sign icon and a “Show Anyway” override.
