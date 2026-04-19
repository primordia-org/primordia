# Pluggable Auth System

## What changed

Refactored the authentication system from a monolithic login page into a **zero-registry plugin architecture** where each authentication mechanism is a fully self-contained unit that can be added, removed, or forked without touching any shared integration file.

### Directory structure

Each auth provider lives in three places that mirror each other by provider ID:

```
lib/auth-providers/<id>/       ← Server-side descriptor (default-export AuthPlugin)
components/auth-tabs/<id>/     ← Client-side tab UI   (default-export ComponentType<AuthTabProps>)
app/api/auth/<id>/…            ← API routes
```

All existing `/api/auth/*` endpoints remain unchanged.

### Provider directories

| Provider | Server descriptor | Client tab | API routes |
|---|---|---|---|
| exe.dev SSO | `lib/auth-providers/exe-dev/index.ts` | `components/auth-tabs/exe-dev/index.tsx` | `app/api/auth/exe-dev/` |
| Passkey | `lib/auth-providers/passkey/index.ts` | `components/auth-tabs/passkey/index.tsx` | `app/api/auth/passkey/{login,register}/*` |
| QR cross-device | `lib/auth-providers/cross-device/index.ts` | `components/auth-tabs/cross-device/index.tsx` | `app/api/auth/cross-device/{start,poll,approve,qr}` |

### Interfaces (`lib/auth-providers/types.ts`)

```typescript
// Server-side descriptor — default export from lib/auth-providers/<id>/index.ts
interface AuthPlugin {
  id: string;       // matches directory name
  label: string;    // shown on the login tab
  getServerProps?: (ctx: AuthPluginServerContext) => Promise<Record<string, unknown>>;
}

// Client tab props — ComponentType<AuthTabProps> is the default export from
// components/auth-tabs/<id>/index.tsx
interface AuthTabProps {
  serverProps: Record<string, unknown>;
  nextUrl: string;
  onSuccess: (username: string) => void;
}
```

### Auto-discovery (zero registry)

`app/login/page.tsx` (server component) calls `fs.readdirSync('lib/auth-providers/')` at request time to discover installed providers — no registry file to maintain. For each discovered directory it dynamically imports the server descriptor, collects `getServerProps()` data, and passes the resolved list to the client.

`app/login/LoginClient.tsx` (client component) loads tab components via `next/dynamic` with a template-literal import path (`@/components/auth-tabs/${id}/index`). Webpack creates a context module at build time that bundles every installed tab component; the runtime ID selects the correct one. No `TAB_COMPONENT_MAP` to maintain.

### Deleted files

- `lib/auth-plugins/registry.ts` — replaced by filesystem auto-discovery
- `components/auth-tabs/index.tsx` — replaced by dynamic import
- `components/auth-tabs/types.ts` — merged into `lib/auth-providers/types.ts`
- `components/auth-tabs/PasskeyTab.tsx`, `ExeDevTab.tsx`, `CrossDeviceTab.tsx` — reorganized to `components/auth-tabs/<id>/index.tsx`

## Why

Previous approaches required editing shared registry files whenever a provider was added or removed. This approach eliminates that friction entirely:

1. **No server registry** — the login page discovers providers by reading the filesystem, so adding a provider means creating a directory, not editing a shared file.
2. **No client registry** — `next/dynamic` with a template-literal path causes webpack to include all matching tab components at build time; the plugin ID selects the right one at runtime.
3. **Minimal footprint** — all files for one auth provider (API routes, server descriptor, client tab) use a common ID prefix, making the package self-describing and easy to add/remove on a fork.

## How to add a new auth provider

1. Create `lib/auth-providers/<id>/index.ts` with a default-exported `AuthPlugin`
2. Create `components/auth-tabs/<id>/index.tsx` with a default-exported `ComponentType<AuthTabProps>`
3. Create API routes under `app/api/auth/<id>/`

No other file needs to be touched. No registry to edit.
