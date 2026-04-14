# Remove GITHUB_TOKEN and GITHUB_REPO env var references

The `git mirror` feature (introduced in the previous changelog entry) replaced the old `GitSyncDialog` / `git-sync` API route, which was the only code that used `GITHUB_TOKEN` and `GITHUB_REPO`. Those environment variables are now completely unused.

## What changed

- **`.env.example`** — removed the commented-out `GITHUB_TOKEN` and `GITHUB_REPO` lines and their explanatory comment block. They no longer serve any purpose and would only confuse new users setting up the project.
- **`README.md`** — removed three references:
  - Updated the local dev quick-start comment (no longer mentions these vars).
  - Removed `GITHUB_REPO` and `GITHUB_TOKEN` from the exe.dev setup checklist step 3.
  - Removed both rows from the Environment Variables table.

## Why

The `GitSyncDialog` component and its backing API route (`app/api/git-sync/route.ts`) were deleted when the git mirror feature landed. Keeping stale documentation for removed env vars misleads users into thinking they need to create a GitHub PAT, which they don't.
