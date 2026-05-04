// lib/auth-providers/passkey/index.ts
// Auth provider descriptor for WebAuthn passkey login/registration.
//
// API routes: app/(auth-passkey)/api/auth/passkey/
// Client tab: components/auth-tabs/passkey/index.tsx

import type { AuthPlugin } from "../types";

const plugin: AuthPlugin<"passkey"> = {
  id: "passkey",
  label: "Passkey",
  // No server-side data needed; all passkey state is managed client-side.
};

export default plugin;
