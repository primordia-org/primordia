# Make branches page log graph styled

Updated the `/branches` page so branch structure reads like `git log --graph` output instead of a filesystem tree. The page renders every local branch head once, connected by recorded branch parentage with git ancestry as a fallback rather than listing every intermediate commit.

Rows now focus on branch names only: no commit hashes, commit subjects, or status text clutter the graph. Child branch heads are visibly indented to the right of their parent, while branch refs keep the existing production/current labels, preview links, and `+ session` actions where applicable.
