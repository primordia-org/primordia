# Match deploy preview accept/reject language to local dev + fix issue creation branch targeting

## What changed

### 1. Match accept/reject bar language to local dev

Updated the Vercel deploy preview accept/reject bar in `ChatInterface.tsx` to use the same language as the local development preview bar, explicitly showing the name of the branch the PR will be merged into.

- The description now reads: "Accepting will merge the PR into `{baseBranch}`. Rejecting will close the PR." — matching the local dev bar's pattern of "Accepting will merge the preview branch into `{previewParentBranch}`."
- The accepted confirmation message now reads: "✅ Changes accepted and merged into `{baseBranch}`." — matching the local dev accepted message.
- Added PR state display (merged/closed indicators) for when a PR was already merged or closed.
- Updated `deploy-context/route.ts` to return both `prBaseBranch` (base/target branch) and `prState` (open/closed/merged) in the API response.
- `prBranch` (the head branch being previewed) is also returned so it can be passed when creating evolve issues.

### 2. Fix evolve issue creation to target the correct branch

When creating an evolve issue from a deploy preview, the issue body now includes instructions for Claude to:
- Base changes on the deploy preview's branch (not `main`)
- Create the PR targeting that same branch (not `main`)

This ensures that evolve requests made from a deploy preview stack on the current PR rather than diverging onto `main` without the preview's changes.

- `ChatInterface.tsx` now passes `deployPrBranch` as `parentBranch` when calling `/api/evolve` from a deploy preview.
- `app/api/evolve/route.ts` accepts the optional `parentBranch` field and embeds branch-targeting git commands in the issue body when the parent branch is not `main`.

### 3. Fix merge conflicts

Resolved merge conflicts between this PR and #76 (branch-based PR lookup). Both `prBaseBranch` (from #76) and `prState` (from this PR) are now present in the response.

## Why

- The local dev preview bar already showed the target branch name; aligning the Vercel bar makes the two flows feel coherent.
- Issues created from deploy previews were always targeting `main`, which meant CI would make changes without the preview's context. Changes should be stacked on the branch being reviewed.
