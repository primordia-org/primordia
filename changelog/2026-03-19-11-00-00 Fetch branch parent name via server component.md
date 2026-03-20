# Fetch branch parent name via server component

## What changed

The accept/reject changes bar in the local preview instance previously detected
whether it was running as a preview worktree by making a client-side `fetch` call
to `GET /api/evolve/local/manage` on every mount of `ChatInterface`.

That API call has been replaced with server-side detection in `app/page.tsx` (a
React Server Component). On each request, `page.tsx` now runs:

```
git rev-parse --abbrev-ref HEAD
git config branch.<name>.parent
```

If a parent branch is found in git config, `isPreviewInstance: true` and the
`previewParentBranch` name are passed directly as props to `ChatInterface`.
`ChatInterface` no longer has state vars for these values and no longer fires
an extra `useEffect` / network round-trip on mount.

## Why

- Eliminates an unnecessary client→server API call on every page load.
- The data is static for the lifetime of a preview server, so fetching it once
  at render time (server-side) is the correct model.
- Keeps the accept/reject bar's *data* in the Server Component layer while its
  interactive handlers (Accept / Reject buttons) remain in the Client Component.
- Aligns with the existing pattern in `page.tsx` which already reads branch and
  commit message server-side.
