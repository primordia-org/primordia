// lib/auth-providers/cross-device/index.ts
// Auth provider descriptor for cross-device QR-code sign-in.
//
// The "requester" device (e.g. laptop) shows a QR code; an already-authenticated
// device (e.g. phone) scans it and approves, granting the laptop a session.
//
// API routes: app/(auth-cross-device)/api/auth/cross-device/
// Client tab: components/auth-tabs/cross-device/index.tsx

import type { AuthPlugin } from "../types";

const plugin: AuthPlugin<"cross-device"> = {
  id: "cross-device",
  label: "QR Code",
  // QR flow is initiated entirely client-side; no server props needed.
};

export default plugin;
