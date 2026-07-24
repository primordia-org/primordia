# Update thread parent on Apply Updates

Apply Updates now records branch-parent trailers on the upstream merge commit it creates. When a thread merges in its effective parent branch, that merge commit includes `Branched-From` and `Base-Commit` trailers pointing at the newly merged parent tip.

This keeps the Threads page parentage graph aligned with the update action: after applying updates from a newer parent branch, the thread's recorded parent becomes that branch instead of staying pinned to the older branch marker.
