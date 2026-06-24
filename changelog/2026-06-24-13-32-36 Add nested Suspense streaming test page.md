# Add nested Suspense streaming test page

Added a developer test page at `/test-pages/nested-suspense-stream` that demonstrates streaming text lines with nested React Suspense boundaries in async Server Components.

The page intentionally delays sections and individual rows so the initial shell renders immediately and the remaining HTML arrives as Suspense boundaries resolve. This provides a non-SSE example alongside the existing markdown SSE streaming test.
