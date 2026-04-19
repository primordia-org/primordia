// lib/auth-plugins/passkey/index.ts
// Auth plugin descriptor for WebAuthn passkey login/registration.
//
// API routes: app/api/auth/passkey/
// Client tab: components/auth-tabs/PasskeyTab.tsx

import type { AuthPlugin } from "../types";

export const passkeyPlugin: AuthPlugin = {
  id: "passkey",
  label: "Passkey",
  // No server-side data needed; all passkey state is managed client-side.
};
