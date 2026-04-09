# Reorganize branches page into Active and Past Sessions sections

## What changed

The `/branches` page has been restructured from a single nested tree into two distinct sections:

### Active
Shows the production branch at the top level, followed by any non-terminal (not accepted or rejected) children and grandchildren. This represents current live work in progress.

### Past Sessions
Lists the chain of past production slots — the blue-green ancestry trail — ordered most recent first (direct parent of production first, then grandparent, etc.). Each past slot may have accepted or rejected sibling branches nested under it (branches that were developed during that era but were not themselves promoted to production).

## Why

The new blue-green branching strategy promotes session branches directly to production, leaving a deep chain of retired slots as parents. Rendering this as a tree made production appear nested many levels deep, which was confusing and hard to read.

The new layout separates "what's active now" from "what happened before", making the page useful at a glance regardless of how many blue-green promotions have occurred.

## Technical details

- Added `isProduction: boolean` to `BranchData` — set from `primordia.productionBranch` git config (falls back to `main`).
- Replaced `buildTree()` with `buildSections()`, which:
  - Walks the parent chain of the production branch to discover past production slots.
  - Builds an active subtree (production + non-terminal descendants only).
  - Builds `PastSlot[]` — each ancestor with its non-chain sibling children.
- Production branch now shows a `(production)` label in blue.
- Accepted/rejected branch names are rendered in dimmed gray in the past sessions list.
- The `+ session` button is suppressed in the Past Sessions section (no point attaching new sessions to retired slots).
- Production branch is also shown in the Diagnostics panel.
- Fixed branch link logic: the production branch links to the root server URL (`http://primordia.exe.xyz:3000`), while all other branches link to their `/preview/{sessionId}` URL. Previously the logic incorrectly used `isCurrent` instead of `isProduction` to decide which URL to show, causing the production branch to display its old preview URL and the current preview branch to display the root URL.
