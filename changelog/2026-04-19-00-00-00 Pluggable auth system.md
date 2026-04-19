# Pluggable Auth System

## What changed

Refactored the authentication system from a monolithic login page into a **plugin architecture** where each authentication mechanism is an independently installable unit.

### New files

| Path | Purpose |
|---|---|
| `lib/auth-plugins/types.ts` | `AuthPlugin` interface, `AuthPluginServerContext`, `InstalledPlugin` — the stable contracts every plugin implements |
| `lib/auth-plugins/registry.ts` | **Server-side integration point.** `INSTALLED_PLUGINS` array + `getInstalledPluginsWithProps()`. Add/remove a plugin here in one line. |
| `lib/auth-plugins/passkey/index.ts` | Plugin descriptor for WebAuthn passkey auth |
| `lib/auth-plugins/exe-dev/index.ts` | Plugin descriptor for exe.dev SSO (reads `X-ExeDev-Email` header via `getServerProps`) |
| `lib/auth-plugins/cross-device/index.ts` | Plugin descriptor for QR-code cross-device sign-in |
| `components/auth-tabs/types.ts` | `AuthTabProps` — the props contract every tab component implements |
| `components/auth-tabs/index.tsx` | **Client-side integration point.** `TAB_COMPONENT_MAP` maps plugin id → React component. Add a tab component here in one line. |
| `components/auth-tabs/PasskeyTab.tsx` | Passkey register/login UI (extracted from LoginClient) |
| `components/auth-tabs/ExeDevTab.tsx` | exe.dev SSO tab UI (extracted from LoginClient) |
| `components/auth-tabs/CrossDeviceTab.tsx` | QR-code cross-device sign-in UI (extracted from LoginClient) |

### Updated files

- `app/login/page.tsx` — now calls `getInstalledPluginsWithProps()` from the registry; passes resolved plugin list (id + label + serverProps) to `LoginClient`
- `app/login/LoginClient.tsx` — rewritten to render tabs dynamically from the `plugins` prop; uses `TAB_COMPONENT_MAP` to look up each tab component; hides inactive tabs with CSS (preserves internal state, e.g. QR polling)

### API routes and DB — unchanged

All existing API routes (`app/api/auth/passkey/`, `app/api/auth/exe-dev/`, `app/api/auth/cross-device/`) are untouched.

## Why

Downstream Primordia forks may want to add their own authentication methods (e.g. OAuth providers, magic links, LDAP). Previously all three auth mechanisms were hard-coded into a single `LoginClient.tsx`, making it difficult to add or remove one without touching shared UI code.

With the plugin architecture, adding a new auth method requires:
1. Create `lib/auth-plugins/<id>/index.ts` implementing `AuthPlugin` (one object with `id`, `label`, optional `getServerProps`)
2. Add one import + one line to `lib/auth-plugins/registry.ts`
3. Create `components/auth-tabs/<Name>Tab.tsx` implementing `AuthTabProps`
4. Add one import + one line to `components/auth-tabs/index.tsx`
5. Add API routes under `app/api/auth/<id>/`

Each plugin is self-contained and the two registry files are the only shared touch-points — making git merges across forks clean and predictable.
