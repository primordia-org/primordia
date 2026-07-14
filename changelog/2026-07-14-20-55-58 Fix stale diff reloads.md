# Fix stale diff reloads

Updated the evolve session files-changed viewer so reloading the diff summary also refreshes any open per-file diffs. Individual diff requests now bypass browser caches, use a cache-busting query parameter, and the diff API responses explicitly send `Cache-Control: no-store`.

This prevents expanded file diffs from continuing to show stale content after agents modify files, without requiring a full page reload.
