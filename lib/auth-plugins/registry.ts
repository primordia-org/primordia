// lib/auth-plugins/registry.ts
// ─────────────────────────────────────────────────────────────────────────────
// THE integration point for authentication plugins.
//
// To install a new auth plugin:
//   1. Import it below (keep alphabetical for clean diffs).
//   2. Add it to INSTALLED_PLUGINS in the order you want tabs to appear.
//   3. Create its client tab component (see components/auth-tabs/index.tsx).
// ─────────────────────────────────────────────────────────────────────────────

import type { AuthPlugin, AuthPluginServerContext, InstalledPlugin } from "./types";
import { crossDevicePlugin } from "./cross-device";
import { exeDevPlugin } from "./exe-dev";
import { passkeyPlugin } from "./passkey";

/**
 * Ordered list of installed auth plugins.
 * The first plugin in this list becomes the default (pre-selected) tab.
 */
const INSTALLED_PLUGINS: AuthPlugin[] = [
  exeDevPlugin,
  passkeyPlugin,
  crossDevicePlugin,
];

/**
 * Returns the installed plugins together with their resolved server props.
 * Call this in the login page server component and pass the result to the client.
 */
export async function getInstalledPluginsWithProps(
  ctx: AuthPluginServerContext
): Promise<InstalledPlugin[]> {
  return Promise.all(
    INSTALLED_PLUGINS.map(async (plugin) => ({
      id: plugin.id,
      label: plugin.label,
      serverProps: plugin.getServerProps ? await plugin.getServerProps(ctx) : {},
    }))
  );
}

/** Returns just the plugin metadata (no server props). */
export function getInstalledPlugins(): AuthPlugin[] {
  return INSTALLED_PLUGINS;
}
