// lib/auth-plugins/types.ts
// Core interfaces for the pluggable authentication system.
//
// To create a new auth plugin:
//   1. Implement AuthPlugin in lib/auth-plugins/<your-plugin>/index.ts
//   2. Register it in lib/auth-plugins/registry.ts (one import + one array entry)
//   3. Create the client tab component in components/auth-tabs/<YourPlugin>Tab.tsx
//   4. Add it to the tab component map in components/auth-tabs/index.tsx
//   5. Add API routes under app/api/auth/<your-plugin>/

/**
 * Minimal context passed to a plugin's getServerProps().
 * Intentionally generic — does not import Next.js types — so plugins
 * can be unit-tested without a Next.js runtime.
 */
export interface AuthPluginServerContext {
  /** HTTP request headers. */
  headers: { get(name: string): string | null };
}

/**
 * Server-side descriptor for one authentication mechanism.
 * Each plugin exports exactly one value of this type from its index.ts.
 */
export interface AuthPlugin {
  /** Immutable slug — used as the tab key and in the client tab map. */
  id: string;
  /** Human-readable name shown on the login tab. */
  label: string;
  /**
   * Optional: gather server-side data to pass down to the client tab component.
   * Called once per page render for each installed plugin.
   * Return an empty object {} if no server data is needed.
   */
  getServerProps?: (
    ctx: AuthPluginServerContext
  ) => Promise<Record<string, unknown>>;
}

/**
 * The resolved metadata for one plugin, ready to pass to the client.
 * Contains the plugin's id + label plus whatever getServerProps returned.
 */
export interface InstalledPlugin {
  id: string;
  label: string;
  serverProps: Record<string, unknown>;
}
