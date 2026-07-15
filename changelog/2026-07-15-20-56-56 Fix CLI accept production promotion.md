# Fix CLI accept production promotion

CLI `primordia accept` now explicitly uses the blue/green production promotion path instead of relying on `NODE_ENV`. This prevents terminal accepts from falling back to the local development quick-merge flow when the CLI process itself is not running with `NODE_ENV=production`.

The web accept path keeps its existing environment-based behavior, while shared accept logic now accepts an explicit production-promotion flag so CLI and web callers can choose the correct deployment mode.
