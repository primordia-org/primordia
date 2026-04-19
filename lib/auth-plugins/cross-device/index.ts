// lib/auth-plugins/cross-device/index.ts
// Auth plugin descriptor for cross-device QR-code sign-in.
//
// The "requester" device (e.g. laptop) shows a QR code; an already-authenticated
// device (e.g. phone) scans it and approves, granting the laptop a session.
//
// API routes: app/api/auth/cross-device/
// Client tab: components/auth-tabs/CrossDeviceTab.tsx

import type { AuthPlugin } from "../types";

export const crossDevicePlugin: AuthPlugin = {
  id: "cross-device",
  label: "QR Code",
  // QR flow is initiated entirely client-side; no server props needed.
};
