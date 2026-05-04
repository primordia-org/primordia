# Auth provider static registry

Replaced the filesystem-scanning `readdirSync` approach for auth providers with a static registry and typed component list.

## What changed

- **`lib/auth-providers/registry.ts`** — `ENABLED_PROVIDERS` is now a `const` string tuple with no imports, making it safe to use in Edge middleware, server code, and client code. `isProviderEnabled()` is derived from it.
- **`middleware.ts`** — new Edge middleware gates all `/api/auth/<provider>/*` requests against `ENABLED_PROVIDERS`. Removing a provider id disables its entire API surface automatically, with no per-route guards needed.
- **`app/login/page.tsx`** — uses `ENABLED_PROVIDERS` + a static `PLUGIN_MAP` (explicit imports per provider) instead of `readdirSync` + dynamic import. Tab order follows the tuple order.
- **`app/login/LoginClient.tsx`** — static imports of all tab components; `AUTH_TABS` is typed as `AuthTabList<typeof ENABLED_PROVIDERS>` so TypeScript enforces that the component array matches the registry tuple exactly (position and id). Removed `next/dynamic` and the module cache. Static imports enable tree-shaking of disabled providers' client code.
- **`lib/auth-providers/types.ts`** — added `AuthTabEntry<Id>` and `AuthTabList<T>` mapped types for the indexed tuple enforcement.
- **`lib/auth-providers/types.ts`** — updated instructions to point to the registry.
- Removed 10 individual `isProviderEnabled()` guards from route files — middleware is now the single enforcement point.

## Why

Previously: disabling a provider required deleting its folder, but only the UI tab disappeared — all API routes stayed active. There was also no way to control tab order, and static analysis tools (knip, fallow) couldn't trace the dynamic `import()` template literals.

Now: one tuple in `registry.ts` is the single source of truth. Removing an id disables the tab (login page skips it), the API (middleware returns 404), and enables tree-shaking of the client bundle (static imports let the bundler eliminate unused tab components). TypeScript catches mismatches between the registry and the component list at compile time.
