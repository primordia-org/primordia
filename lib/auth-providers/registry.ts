// lib/auth-providers/registry.ts
// Single source of truth for which auth providers are enabled and in what order.
//
// To disable a provider: remove its id from ENABLED_PROVIDERS.
// To add a new provider: add its id here, then add entries in:
//   - app/login/page.tsx (server plugin import + resolveProviders map)
//   - app/login/LoginClient.tsx (tab component import + AUTH_TABS entry)
//   - app/api/auth/<id>/ (API routes — middleware gates them automatically)
//
// This file has no imports so it is safe to use in middleware (Edge runtime).

export const ENABLED_PROVIDERS = ["exe-dev", "passkey", "cross-device"] as const;

export type ProviderId = (typeof ENABLED_PROVIDERS)[number];

const enabledSet = new Set<string>(ENABLED_PROVIDERS);

/** Returns true if the given provider id is in the enabled registry. */
export function isProviderEnabled(id: string): boolean {
  return enabledSet.has(id);
}
