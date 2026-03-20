# Match deploy preview accept/reject language to local dev

## What changed

Updated the Vercel deploy preview accept/reject bar in `ChatInterface.tsx` to use the same language as the local development preview bar, explicitly showing the name of the branch the PR will be merged into.

- The description now reads: "Accepting will merge the PR into `{baseBranch}`. Rejecting will close the PR." — matching the local dev bar's pattern of "Accepting will merge the preview branch into `{previewParentBranch}`."
- The accepted confirmation message now reads: "✅ Changes accepted and merged into `{baseBranch}`." — matching the local dev accepted message.
- Updated `deploy-context/route.ts` to include `base.ref` in the `GitHubPR` type and return `prBaseBranch` in the API response so the UI can display the actual target branch name.

## Why

The local dev preview bar already showed the target branch name, giving users clear context about where their changes would land. The Vercel deploy preview bar only said "trigger a production deployment" without naming the target branch. This inconsistency was confusing — aligning the language makes the two flows feel coherent.
