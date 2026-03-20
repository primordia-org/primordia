# Fall back to branch-based PR lookup and show PR state in deploy preview bar

## What changed

### `app/api/deploy-context/route.ts`
- When `VERCEL_GIT_PULL_REQUEST_ID` is empty (Vercel deployed the branch before a PR was opened) and the branch is not `main`/`master`, the endpoint now searches for an associated PR by branch name using the GitHub API (`/pulls?head={owner}:{branch}&state=all`).
- A new `prState` field (`"open" | "closed" | "merged"`) is returned in the response alongside the existing `prNumber` and `prUrl`.
- The `GitHubPR` interface now includes `state` and `merged_at` fields.

### `components/ChatInterface.tsx`
- A new `deployPrState` state variable tracks the PR's current state.
- The Vercel preview accept/reject bar now behaves differently based on `prState`:
  - **`"merged"`**: Shows a notice that the PR is already merged (no accept/reject buttons).
  - **`"closed"`**: Shows a notice that the PR was already closed/discarded (no accept/reject buttons).
  - **`"open"` or unknown**: Shows the normal accept/reject buttons as before.

## Why

When Vercel creates a deployment for a branch push that happens before a PR is made, `VERCEL_GIT_PULL_REQUEST_ID` is an empty string. Previously, the deploy-context API returned `null` in this case, so the preview bar and PR context were never shown. This fix ensures the PR is still found (if one was later opened) and the UI correctly reflects the PR's current state — avoiding presenting accept/reject actions when the PR is already resolved.
