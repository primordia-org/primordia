# Consolidate frontend code across dev and Vercel flows

## What changed

Frontend components (`ChatInterface`, `EvolveForm`, `AcceptRejectBar`) no longer contain
any environment-specific logic. All `process.env.NODE_ENV` and `process.env.VERCEL_*`
checks have been moved to backend code (API routes and server components).

### Specific changes

- **`app/api/evolve/route.ts`**: Now handles both local and production evolve flows.
  In `NODE_ENV=development`, it bypasses GitHub and starts a local worktree session,
  returning `{ mode: "local", sessionId }`. In production it returns `{ mode: "github",
  issueNumber, issueUrl }` as before. The frontend always calls `/api/evolve` regardless.

- **`lib/local-evolve-sessions.ts`**: Extracted `generateSlug` and added a new
  `createLocalEvolveSession` helper, centralising local-session startup logic that was
  previously duplicated.

- **`app/api/evolve/local/route.ts`**: Simplified to use the shared `createLocalEvolveSession`
  helper from lib (still responds to direct requests; kept for backward-compat polling endpoint).

- **`components/EvolveForm.tsx`**: Removed `NODE_ENV` branch in `handleSubmit` — always calls
  `/api/evolve`. `performEvolveCreate` now dispatches to local-polling or GitHub-polling based
  on the `mode` field in the response. Removed `handleLocalEvolveSubmit`. Added `isLocalDev`
  prop (set by the server component) for the description banner text.

- **`app/evolve/page.tsx`**: Passes `isLocalDev={process.env.NODE_ENV === "development"}` to
  `EvolveForm` so it can render the correct banner without checking `process.env` itself.

- **`components/ChatInterface.tsx`**: Removed `VERCEL_ENV` guard from the deploy-context fetch
  (API returns null on non-preview builds). Replaced inline `process.env.VERCEL_*` in the
  header with `headerHref` and `prLink` props passed down from `app/page.tsx`.

- **`app/page.tsx`**: Computes `headerHref` and `prLink` from Vercel env vars and passes them
  to `ChatInterface` as props.

- **`components/AcceptRejectBar.tsx`**: Removed `VERCEL_ENV` guard from the deploy-context
  fetch (same reason — API returns null on non-preview builds).

## Why

The frontend was branching on `process.env.NODE_ENV` and `process.env.VERCEL_ENV` to decide
which API routes to call and how to render the UI. This made the client components tightly
coupled to the deployment environment. By moving those decisions to API routes (backend) and
server components, the client code is now environment-agnostic and easier to reason about.
