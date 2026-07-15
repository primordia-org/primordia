# Instant Page Data Loading Strategy

## Goal

Primordia should avoid the UX where a route first renders a shell, then client JavaScript calls an API route, then the real content appears. For normal page data, the first HTML/RSC response should already contain the data needed to render the page. Client-side fetches should be reserved for user-triggered mutations, live streams, polling, previews, and intentionally lazy details.

## Current pattern to reduce

A quick audit shows several client components fetch initial page data after mount:

- `app/admin/events/EventsClient.tsx` fetches event rows from `/api/events`.
- `app/admin/rollback/AdminRollbackClient.tsx` fetches rollback targets from `/api/admin/rollback`.
- `app/admin/server-health/AdminServerHealthClient.tsx` fetches health and proxy settings from admin APIs.
- `app/admin/git-mirror/GitMirrorClient.tsx` fetches mirror status from `/api/admin/git-mirror`.
- `app/admin/instance/InstanceConfigClient.tsx` fetches instance config from `/api/instance/config`.
- `app/settings/*Client.tsx` and `components/SettingsSubNav.tsx` fetch billing-source and preset data after mount.
- `components/ModelPicker.tsx` and parts of `app/thread/[id]/ThreadView.tsx` fetch model metadata after mount.

Some client fetches are still appropriate: SSE logs, evolve progress streams, preview server status, file diff expansion, OAuth/device-code polling, and submit/update/delete actions.

## Recommended default: Solution 1 — Server-first data access modules

### Summary

Make Server Components the default source of initial page data. Move the shared query logic behind API routes into server-only data functions, then call those functions directly from `page.tsx` and pass the resulting data into client components as props.

### Rules

1. A page must not require a `useEffect(...fetch...)` call to show its initial content.
2. If a page needs authenticated DB, git, filesystem, or git-config data, load it in the route's server component.
3. API routes remain for external clients, mutations, polling, SSE, and client-triggered refreshes.
4. Reuse logic by extracting a `getXxxPageData()`/`listXxx()` function, not by having the server component call its own HTTP API route. Prefer co-locating route-specific helpers in a `data.ts` file inside the relevant App Router folder (for example `app/settings/data.ts` or `app/admin/rollback/data.ts`); use `lib/` only for helpers that are genuinely shared across unrelated routes.
5. Client components receive `initialData` props and update local state only after mutations or explicit refresh actions.
6. New PRs should treat mount-time data fetching as a code-review smell unless it is realtime, user-triggered, or intentionally lazy.

### Example migration shape

Before:

```tsx
// Client component
useEffect(() => {
  fetch(withBasePath('/api/admin/rollback')).then(...)
}, [])
```

After:

```tsx
// app/admin/rollback/page.tsx, server component
const initialRollbackState = await getRollbackPageData()
return <AdminRollbackClient initialState={initialRollbackState} />
```

```tsx
// app/admin/rollback/AdminRollbackClient.tsx
export function AdminRollbackClient({ initialState }: Props) {
  const [state, setState] = useState(initialState)
  // Only POST actions or explicit refreshes fetch later.
}
```

### Benefits

- Best fit for Next.js App Router and Primordia's existing architecture.
- No new dependency.
- Better first render, SEO, accessibility, and no loading flashes for core data.
- Keeps secrets and privileged reads on the server.
- Works well with `ForbiddenPage` because auth and permission checks happen before rendering.

### Costs / token estimate

- Add guidance and extract the first shared data helpers: **8k-14k tokens**.
- Migrate one medium admin/settings page: **6k-12k tokens**.
- Migrate the current obvious page-load fetches listed above: **80k-140k tokens** across several PRs.

### Risks

- Some API route logic is currently embedded in route handlers and must be carefully extracted to avoid behavior drift.
- Server components cannot use browser-only APIs, so client islands still need clean prop boundaries.

## Considered but rejected: Solution 2 — TanStack Query with SSR hydration

### Summary

TanStack Query (`@tanstack/react-query`) was considered as a way to prefetch page queries in Next.js server components, dehydrate them, and hydrate the client cache. That approach can render pages with data immediately while giving client components a cache, background refetching, invalidation after mutations, and pagination helpers.

However, Primordia should **not** adopt TanStack Query for this effort now. The added dependency, provider setup, query-key discipline, hydration rules, and second data-loading mental model create more implementation risk than simply enforcing data fetching in Server Components. It also leaves room for future code to accidentally use client-only `useQuery` loading states and recreate the UX problem this plan is meant to eliminate.

### Rules

1. Every page query must be prefetched on the server for the initial route.
2. `useQuery` is allowed for page data only when it has hydrated `initialData`/dehydrated state.
3. Mutations invalidate the relevant query keys.
4. Query functions should call shared data modules on the server and API routes only in the browser.

### Benefits

- Strong caching and invalidation model for interactive admin/settings pages.
- Good fit for paginated/filterable views like `/admin/events`.
- Can reduce duplicate local state code in client components.

### Costs / token estimate

- Add dependency, provider, hydration helpers, and conventions: **15k-25k tokens**.
- Migrate one medium page: **8k-15k tokens**.
- Migrate the current obvious page-load fetches: **90k-160k tokens**.

### Risks

- Adds a dependency and a second data-loading mental model.
- If used without SSR prefetching, it recreates the same loading-flash problem with nicer APIs.
- Sensitive data still needs careful server-side boundaries.

## Alternative: Solution 3 — Route-level Suspense with server streaming

### Summary

For data that is slow but still needed on load, keep fetching on the server and wrap sections in Suspense boundaries. The page streams useful server-rendered sections as they resolve instead of mounting an empty client shell.

### Benefits

- No new dependency.
- Useful for naturally slow data such as live log buffers or expensive git scans.
- Lets the header/navigation render immediately while main sections stream from the server.

### Costs / token estimate

- Establish examples and conventions: **6k-10k tokens**.
- Apply selectively to slow pages: **4k-10k tokens per page**.

### Risks

- Suspense fallbacks are still loading UI. Use this only where instant complete render is impossible or undesirable.
- Not a substitute for server-first page data.

## Decision

Adopt **Solution 1** as Primordia's default rule now. Enforce data fetching in Server Components for initial page content instead of adding TanStack Query. TanStack Query was considered, but its added complexity and dependency risk outweigh its benefits for this problem.

Use **Solution 3** selectively for genuinely slow server data. Reconsider a client query cache only if a future, concrete interaction pattern cannot be handled cleanly with Server Component data loading, `initialData` props, and explicit refreshes after mutations.

## Implementation plan

1. Add a project design principle: server-load initial page data; avoid mount-time client fetches for first render.
2. For each target page, extract shared server data helpers from API route handlers into route-local `data.ts`/`*-page-data.ts` files in the relevant App Router folder. Move helpers to `lib/` only when multiple unrelated route areas need the same domain logic.
3. Change `page.tsx` to call the helper after auth/permission checks.
4. Pass data to client components as `initialData`/`initialState` props.
5. Keep API routes for mutations, explicit refresh buttons, SSE, polling, and public/external API consumers.
6. Add or update tests where business logic is extracted.

## Priority migration list

1. `/admin/rollback` — small and visible admin UX win.
2. `/admin/git-mirror` and `/admin/instance` — good examples of server-loaded forms with client mutations.
3. `/admin/server-health` — split initial server data from explicit cleanup/proxy-setting actions.
4. `/settings` and `/settings/presets` — remove initial billing/model/preset loading flashes.
5. `/admin/events` — server-render first page of results; keep client-side filter/pagination refreshes.
6. Evolve model metadata — load model options server-side for initial evolve/session forms where practical.
