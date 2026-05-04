// lib/auth-providers/exe-dev/index.ts
// Auth provider descriptor for exe.dev SSO (header-injected login).
//
// exe.dev's HTTP reverse proxy injects X-ExeDev-Email for authenticated users.
// getServerProps reads this header and passes it to the client tab so it can
// show the pre-authenticated email and offer a one-click sign-in button.
//
// API routes: app/(auth-exe-dev)/api/auth/exe-dev/
// Client tab: components/auth-tabs/exe-dev/index.tsx

import type { AuthPlugin } from "../types";

const plugin: AuthPlugin<"exe-dev"> = {
  id: "exe-dev",
  label: "exe.dev",
  async getServerProps({ headers }) {
    return {
      // null when the user is not yet authenticated with exe.dev.
      email: headers.get("x-exedev-email") ?? null,
    };
  },
};

export default plugin;
