// lib/auth-plugins/exe-dev/index.ts
// Auth plugin descriptor for exe.dev SSO (header-injected login).
//
// exe.dev's HTTP reverse proxy injects X-ExeDev-Email for authenticated users.
// getServerProps reads this header and passes it to the client tab so it can
// show the pre-authenticated email and offer a one-click sign-in button.
//
// API routes: app/api/auth/exe-dev/
// Client tab: components/auth-tabs/ExeDevTab.tsx

import type { AuthPlugin } from "../types";

export const exeDevPlugin: AuthPlugin = {
  id: "exe-dev",
  label: "exe.dev",
  async getServerProps({ headers }) {
    return {
      // null when the user is not yet authenticated with exe.dev.
      email: headers.get("x-exedev-email") ?? null,
    };
  },
};
