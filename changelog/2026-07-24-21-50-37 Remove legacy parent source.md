# Remove legacy parent source

Removed the per-user legacy git-config parent source and made branch-marker commits the only source of thread parentage. This removes the `/threads` toggle, stops writing `branch.<name>.parent` metadata for new sessions/update threads, and updates diff/upstream/accept flows to resolve parents directly from branch-marker trailers.

This keeps parentage portable through git clones and avoids divergent behavior between local git config and committed branch metadata.
