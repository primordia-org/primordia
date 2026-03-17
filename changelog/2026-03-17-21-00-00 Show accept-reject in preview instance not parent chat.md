# Show accept/reject in preview instance, not parent chat

## What changed

In local development evolve mode, the **Accept / Reject** UI now appears inside
the newly-created preview instance (the child Next.js dev server) instead of in
the parent chat. The preview instance manages its own accept/reject flow entirely
via git config — no cross-origin requests or URL params are required.

### Specific changes

- **`lib/local-evolve-sessions.ts`**:
  - On worktree creation, records the current branch as `git config branch.<preview-branch>.parent <parent-branch>` so the preview server can find where to merge back.
  - Exports `runGit` so the manage route can reuse it.
  - Passes `PREVIEW_BRANCH=<branch-name>` in the environment when spawning the preview dev server, so the server knows it is a preview instance.
  - Removed `acceptSession` and `rejectSession` — cleanup is now handled by the preview instance itself.

- **`app/api/evolve/local/manage/route.ts`**:
  - Removed CORS headers and `OPTIONS` handler (no longer needed — same-origin only).
  - Added `GET` handler that returns `{ isPreview: boolean, branch: string | null }` based on the `PREVIEW_BRANCH` env var.
  - Rewrote `POST` handler: reads `PREVIEW_BRANCH` from env, locates the parent repo root via `git rev-parse --git-common-dir`, reads the parent branch from `git config branch.<branch>.parent`, performs the merge (accept) or skips it (reject), removes the worktree and branch in the parent repo, then calls `process.exit(0)` to shut itself down.

- **`components/ChatInterface.tsx`**:
  - Removed `useSearchParams` import and all `searchParams` / `previewSessionId` / `previewParentOrigin` state.
  - On mount, fetches `GET /api/evolve/local/manage` to detect whether this instance is a preview; sets `isPreviewInstance` accordingly.
  - `handlePreviewAccept` and `handlePreviewReject` now POST to the instance's own `/api/evolve/local/manage` (same origin, no `sessionId` or `parentOrigin` needed).
  - Preview URL shown in the parent chat is now the plain `http://localhost:<port>` link (no query params).
  - Removed dead-code `handleLocalAccept` and `handleLocalReject`.

- **`app/page.tsx`**: Removed `<Suspense>` wrapper — it was only needed because `useSearchParams` required it.

## Why

The previous implementation passed `sessionId` and `parentOrigin` as URL query
params on the preview link, and the preview instance used them to POST
cross-origin to the parent server. This required CORS headers and the Accept /
Reject handlers to reach back out to a specific `localhost` port.

Using `git config` to store the parent branch name lets the preview instance
handle its own lifecycle: it merges into the parent branch (discovered from git
config), removes its own worktree and branch via the parent repo, and exits —
all without needing to know the parent server's address.
