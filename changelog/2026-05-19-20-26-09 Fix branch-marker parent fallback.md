# Fix branch-marker parent fallback

Branch parent resolution in branch-marker mode now handles branches that were created before marker commits existed. When a marker is missing, Primordia falls back to legacy git-config parent metadata and then to git ancestry from the current production branch.

New evolve sessions now also write their branch-marker commit even when the API route creates the worktree synchronously before handing off to the async evolve pipeline. That synchronous creation path was skipping marker writes, which is why recent branches such as `automate-common-steps` and this fix branch were missing marker commits.

Existing-branch sessions started from `/branches` are explicitly marked as pre-existing branches so Primordia does not overwrite their parent metadata or add misleading marker commits.
