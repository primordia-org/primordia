# Fix bundled reverse proxy root detection

- Fixed the bundled reverse proxy resolving `source.git` relative to the source `scripts/` directory instead of the installed Primordia directory.
- Made reverse proxy root detection use the invoked entrypoint path and fail loudly when the expected `source.git` and `worktrees` directories are missing.
- Updated process status detection to recognize the installed `reverse-proxy.js` bundle.
