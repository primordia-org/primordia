# Polish local evolve sessions

## What changed

### Human-readable worktree and branch names

Installed `mnemonic-id` (v4.1.0). Local evolve sessions now generate names by combining a Claude-generated kebab-case slug (3–5 words summarising the change request, produced by `claude-haiku-4-5`) with a `createNameId()` mnemonic suffix — e.g. `add-dark-mode-toggle-ancient-fireant`.

- **Worktrees** are created under a shared `../primordia-worktrees/{slug}-{mnemonicId}` directory instead of scattering `primordia-preview-*` folders in the parent.
- **Branch names** follow `evolve/{slug}-{mnemonicId}`, consistent with the CI convention.
- A first-5-words fallback is retained so slug generation never blocks session creation if the API call fails.

### Worktree sandboxing

Added a `PreToolUse` hook (`makeWorktreeBoundaryHook`) to the `query()` call in `lib/local-evolve-sessions.ts`. The hook blocks any tool call whose target resolves outside the session's `worktreePath`:

- **Read / Write / Edit** — `file_path` is resolved and checked.
- **Glob / Grep** — `path` is checked when it is an absolute path.
- **Bash** — commands referencing the main repo root path are blocked, preventing `git -C /main/repo …`-style escapes.

### Git context in UI via server component

`app/page.tsx` is now a React Server Component that reads the current git branch and full HEAD commit message at request time using `execSync` (falling back to Vercel env vars on Vercel). The values are passed as props (`branch`, `commitMessage`) to `ChatInterface`, eliminating the former client-side `fetch("/api/git-context")` on mount and removing the `app/api/git-context/` route entirely.

- The browser tab title reads **Primordia (branch-name)**.
- The h1 header shows the branch name in muted gray.
- On load, an assistant message shows **"Most recent change: {full commit message}"** (changed from the previous "Ok, here's what's changed:" phrasing, and now showing the full commit body rather than just the subject line).

### Correct parent branch in accept/reject flow

The accept action in `app/api/evolve/local/manage/route.ts` now:

1. Reads the parent branch from `git config branch.<evolveBranch>.parent` (stored at session-creation time by `startLocalEvolve`).
2. Checks out that parent branch in the main repo before merging, so the merge always lands on the originating branch rather than whatever happened to be checked out.
3. Handles the case where the parent branch is already checked out in another worktree (stacked evolve sessions): if `git checkout` fails with `already checked out at '<path>'`, the reported path is used as `mergeRoot` instead.

`app/page.tsx` also reads `git config branch.<name>.parent` server-side and passes `isPreviewInstance` and `previewParentBranch` as props to `ChatInterface`, replacing the previous client-side `GET /api/evolve/local/manage` call on every mount. The accept/reject bar now shows the actual parent branch name (e.g. `feature/my-branch`) in both the description and the post-accept success message.

### Welcome message cleanup

Removed the sentence "Your idea will be turned into a GitHub PR automatically." from the welcome message — it was an implementation detail of the production pipeline that was confusing in local dev where no PR is created.

## Why

The old local evolve flow had accumulated several rough edges:

- Opaque timestamp-based names made worktree paths unreadable and cluttered the parent directory.
- The Claude agent running inside a worktree could still use absolute paths to escape to the main checkout — in at least one observed case it committed directly to the main branch.
- Git context (branch, commit) was fetched client-side via an extra HTTP round-trip on every page load, even though it's static for the lifetime of a local server.
- Accepting a change merged into whichever branch happened to be checked out in the main repo, not necessarily the branch the session was forked from.
- Stacked evolve sessions (where the parent is itself an `evolve/…` branch checked out in another worktree) caused the accept action to fail with a git error.
- The accept/reject bar always said "merge into `main`" regardless of the real parent branch.
