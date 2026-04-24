# Fix unattached branch visibility on branches page

## What changed

### `/branches` page — new "Other Branches" section

`buildSections()` previously only rendered branches that were reachable from the
production branch tree (either as descendants via the `branch.<name>.parent` git
config, or as ancestors in the blue-green promotion chain). Any branch with no
`parent` config — including manually created branches and worktrees — was fetched
from git but silently dropped from the UI.

`buildSections` now computes a `covered` set (everything reachable from the
production chain in either direction) and returns an `unattached` list of all
remaining branches. The page renders these in a new **Other Branches** section
below Past Sessions.

## Why

A developer created a worktree manually for the `cleanup-installer` branch and
expected it to appear on `/branches`. It didn't, because it had no `parent` config
connecting it to the production tree, so `buildSections` silently dropped it.

With the branch now visible in "Other Branches", the developer can use the
**+ session** button to create a proper evolve session with a session ID, which
will then be routable via `/preview/<sessionId>` through the normal flow.
