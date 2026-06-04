# Add typed OpenAPI client with openapi-typescript and openapi-fetch

## What changed

- Added `openapi-typescript` (dev dep) and `openapi-fetch` (runtime dep, ~6 kB) to the project.
- Created `lib/api-types.ts` — auto-generated TypeScript type definitions for all API paths, operations, request bodies, and response shapes, derived from the OpenAPI spec.
- Created `lib/api-client.ts` — a shared, typed HTTP client factory built on `openapi-fetch`. Exports:
  - `apiClient` — pre-built browser/client-component instance using a relative base URL (respects `NEXT_PUBLIC_BASE_PATH`)
  - `createApiClient(baseUrl?)` — factory for server-side or test contexts that need an explicit origin
- Created `scripts/generate-api-types.ts` — a regeneration script (`bun run generate:api-types`) that: (1) regenerates `public/openapi.json` via `next-openapi-gen`, (2) patches a broken `$ref` that the generator emits for `Record<string, T>` return types, and (3) runs `openapi-typescript` to produce `lib/api-types.ts`.
- Added `"generate:api-types"` npm script to `package.json`.
- Migrated several client-side `fetch()` calls to use the typed client:
  - `lib/hooks.ts` — `useSessionUser()` (session fetch + logout)
  - `components/AdminUpdatesBell.tsx` — evolve sessions, upstream-updates, and dependency-alert polling
  - `components/EvolveRequestForm.tsx` — presets fetch
  - `app/evolve/session/[id]/EvolveSessionView.tsx` — models fetch, abort, upstream-sync, accept, reject
  - `app/branches/BranchParentSourceToggle.tsx` — PATCH branch parent source
  - `app/changelog/ChangelogEntryDetails.tsx` — changelog body lazy-load

## Why

Raw `fetch()` calls with manual `as` casts are invisible to the type system — a response field rename, a missing required body param, or a wrong status code pattern can silently break the app with no compile-time signal.

`openapi-fetch` layers full TypeScript types on top of the native `fetch` API with zero runtime overhead (6 kB, no SDK, no codegen runtime). Every API call now gets:

- **Path type safety** — typos in `/api/...` routes are caught at compile time.
- **Typed request bodies** — missing required fields or wrong field types are compiler errors.
- **Typed responses** — `data` and `error` shapes reflect the actual spec, eliminating ad-hoc `as { field?: string }` casts.
- **Query param type checking** — where the spec includes parameter definitions.

The pattern is opt-in and additive — existing `fetch()` calls that work against endpoints with incomplete spec coverage (SSE streams, FormData multipart, proxy internal endpoints) are left unchanged or can be migrated endpoint-by-endpoint as the spec matures.
