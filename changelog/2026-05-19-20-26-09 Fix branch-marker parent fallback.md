# Fix branch-marker parent fallback

Branch parent resolution in branch-marker mode now handles branches that were created before marker commits existed. When a marker is missing, Primordia falls back to legacy git-config parent metadata and then to git ancestry from the current production branch.

This fixes cases like `automate-common-steps`, which is based on production but previously appeared as an unattached branch when viewing `/branches` with the branch-marker source selected.
