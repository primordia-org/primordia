# Track branch parents via fork markers

Branch parentage is now recorded in an empty fork-marker commit on new evolve session branches instead of relying only on local git config.

This adds helpers for writing and reading `Primordia-Forked-From` commit trailers, updates diff/upstream/accept/session/branch views to resolve parents through those helpers, and removes deploy-time sibling reparenting because parent resolution now falls back to the current production branch when the original parent has been deployed.

This makes branch parent metadata travel with pushes and clones while preserving legacy git-config fallback for older sessions.
