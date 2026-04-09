# Add git diff summary to Session page

## What changed

The evolve Session page now shows a collapsible **"Files changed"** section once a session reaches the `ready`, `accepted`, or `rejected` state.

The section displays:
- A summary header: file count, total insertions (`+N` in green), and total deletions (`-N` in red)
- A per-file table with filename, insertions, and deletions in a monospace font

## Implementation details

- `app/evolve/session/[id]/page.tsx` — added `getGitDiffSummary()` which runs `git diff --numstat parent...sessionBranch` (three-dot notation) to capture only commits exclusive to the session branch. Returns an array of `{ file, additions, deletions }` objects. The result is passed as the new `diffSummary` prop to `EvolveSessionView`.
- `components/EvolveSessionView.tsx` — added `diffSummary: DiffFileSummary[]` prop and renders the collapsible diff section between the progress log and the Upstream Changes / Available Actions panels.

## Why

Reviewers need to quickly see which files were touched and how large the change is before deciding to Accept or Reject — the same information a GitHub PR "Files changed" tab provides.
