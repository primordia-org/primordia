# Fix wording for production blue-green deploys

## What changed

In a production (blue/green) deploy, the session branch is **not merged** into the parent branch — it becomes the new production slot as-is (the parent branch ref is not advanced). The UI was incorrectly saying "merged into" in three places.

### `app/api/evolve/manage/route.ts`

- The "Accepting" section heading in the progress log now reads `### 🚀 Deploying to production` instead of `### 🚀 Merging into <parent>` when `NODE_ENV === 'production'`.
- The decision log entry appended on accept now reads `✅ **Accepted** — deployed to production` instead of `✅ **Accepted** — merged into \`<parent>\`` in production.
- Both the `runAcceptAsync` and `retryAcceptAfterFix` paths are updated consistently.

### `components/EvolveSessionView.tsx`

- Added detection of the new `deployed to production` decision log pattern alongside the existing `merged into` pattern.
- The "Changes accepted" banner now reads **"The branch was deployed to production and the worktree has been removed."** for production deploys, instead of the inaccurate merge message.
- The fallback for older sessions (no recognisable decision line) now reads "The branch was accepted and the worktree has been removed." instead of the misleading "merged" wording.

## Why

The previous wording implied a `git merge` happened, which is only true in the legacy local-dev path. In the production blue/green path, the proxy is pointed at the new slot without any merge commit — saying "merged into" was factually wrong and confusing to users watching the progress log.
