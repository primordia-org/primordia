# Create test-pr-create PR Programmatically

## What changed
- Pushed an empty commit to the `test-pr-create` branch (which had no commits beyond `main`) to satisfy GitHub's requirement that a PR branch must have at least one commit ahead of the base branch.
- Created PR #60 for `test-pr-create` → `main` via the `gh` CLI.

## Why
GitHub's UI and API both refuse to create a pull request when there are no commits between the head branch and the base branch. Pushing an empty commit unblocks PR creation and also lets Vercel detect the PR at build time, triggering a preview deployment.
