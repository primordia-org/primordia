// components/auth-tabs/index.tsx
// ─────────────────────────────────────────────────────────────────────────────
// THE client-side integration point for authentication plugin tab components.
//
// To add a new auth plugin's UI:
//   1. Create components/auth-tabs/<YourPlugin>Tab.tsx implementing AuthTabProps.
//   2. Import and add it to TAB_COMPONENT_MAP below (one import + one entry).
//
// The key must match the AuthPlugin.id registered in lib/auth-plugins/registry.ts.
// ─────────────────────────────────────────────────────────────────────────────

import type { ComponentType } from "react";
import type { AuthTabProps } from "./types";
import { CrossDeviceTab } from "./CrossDeviceTab";
import { ExeDevTab } from "./ExeDevTab";
import { PasskeyTab } from "./PasskeyTab";

/**
 * Maps plugin id → the React component that renders that plugin's login tab.
 * Keys must match the `id` fields in lib/auth-plugins/registry.ts.
 */
export const TAB_COMPONENT_MAP: Record<string, ComponentType<AuthTabProps>> = {
  "cross-device": CrossDeviceTab,
  "exe-dev": ExeDevTab,
  passkey: PasskeyTab,
};

export type { AuthTabProps };
