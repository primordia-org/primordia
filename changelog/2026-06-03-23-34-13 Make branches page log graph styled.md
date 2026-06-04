# Make branches page log graph styled

Updated the `/branches` page so branch structure reads like `git log --graph` output instead of a filesystem tree. The page renders every local branch head once, connected by recorded branch parentage with git ancestry as a fallback rather than listing every intermediate commit.

Rows focus on branch names: no commit hashes, commit subjects, or extra section header clutter the graph. The page now uses the Unicode graph layout directly, while preserving branch hyperlinks, production/current labels, `[ready]`-style session status labels, preview-open buttons, and `+ session` actions where applicable.

Added `bun run export-branch-parentage-mermaid`, a small diagnostic tool that exports the conceptual branch-parent DAG as a Mermaid `flowchart`. It defaults to branch-marker parentage, uses readable branch names as node IDs, and adds labeled merge edges for merges between current local branch heads so the parentage model can be inspected independently from the visual branch graph.

Added `computeBranchGraphLayout()` plus `bun run export-branch-graph-ascii` to prototype a simplified git-log-style layout: production and its parent chain form a column-0 spine, each branch gets its own row, child branches are placed above their parent to the right, and newer sibling branches are placed closer to the spine. Added `bun run export-branch-graph-unicode` for a fancier Unicode rendering with branch dots, multi-child connectors, and merge hints.
