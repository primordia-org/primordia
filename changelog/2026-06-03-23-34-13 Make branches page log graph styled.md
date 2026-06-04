# Make branches page log graph styled

Updated the `/branches` page so branch structure reads like `git log --graph` output instead of a filesystem tree. The page renders every local branch head once, connected by recorded branch parentage with git ancestry as a fallback rather than listing every intermediate commit.

Rows now focus on branch names only: no commit hashes, commit subjects, or status text clutter the graph. Child branch heads are visibly indented to the right of their parent, while branch refs keep the existing production/current labels, preview links, and `+ session` actions where applicable.

Added `bun run export-branch-parentage-mermaid`, a small diagnostic tool that exports the conceptual branch-parent DAG as a Mermaid `flowchart`. It defaults to branch-marker parentage, uses readable branch names as node IDs, and adds labeled merge edges for merges between current local branch heads so the parentage model can be inspected independently from the visual branch graph.

Added `computeBranchGraphLayout()` plus `bun run export-branch-graph-ascii` to prototype a simplified git-log-style layout: production and its parent chain form a column-0 spine, child branches are placed one row above their parent in the nearest open column to the right, and older marker commits are placed closer to the spine.
