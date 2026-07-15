# Fix stale diff reloads

Updated the evolve session files-changed viewer so reloading the diff summary also refreshes any open per-file diffs. Individual diff requests now use HTTP revalidation with ETags derived from the diff content hash, so unchanged diffs can return `304 Not Modified` while changed diffs update without requiring a full page reload.

The diff summary now detects renames and passes the resolved destination path to the per-file diff endpoint. This fixes renamed files showing an empty expanded diff when the visible summary label used Git's `old => new` rename notation instead of a real path.
