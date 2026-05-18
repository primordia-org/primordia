# Fix preview restart proxy crash

Clicking the restart server button on an evolve session now runs the reverse proxy preview restart path inside an error-handled async wrapper. If starting the preview dev server fails, the proxy returns a JSON 500 response and cleans up the stale preview entry instead of risking an unhandled promise rejection that could crash the proxy process.

The proxy's top-level HTTP request handler now catches unexpected async errors and returns a controlled 500 response. Preview log fan-out also ignores broken subscribers so a disconnected log stream cannot throw while restart output is being forwarded.
