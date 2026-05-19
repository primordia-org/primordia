# Fix branch-marker parent fallback

Branch parent resolution in branch-marker mode now handles branches that were created before marker commits existed. When a marker is missing, Primordia falls back to legacy git-config parent metadata and then to git ancestry from the current production branch.

New evolve sessions now write their branch-marker commit during the synchronous worktree creation step, before the API returns a session ID. Marker creation failures return a 500 with the underlying git error instead of being hidden behind the asynchronous evolve pipeline or suppressed stderr. The async setup path also verifies/writes missing markers for new branches without duplicating an existing marker.

Existing-branch sessions started from `/branches` are explicitly marked as pre-existing branches so Primordia does not overwrite their parent metadata or add misleading marker commits.
