// app/login/page.tsx — Server component: resolves enabled auth providers,
// collects per-provider server props, then delegates to the client UI.
//
// To add, remove, or reorder providers: edit lib/auth-providers/registry.ts,
// then update the PLUGIN_MAP below to match.

import { headers } from "next/headers";
import type { Metadata } from "next";
import { getSessionUser } from "@/lib/auth";
import type { InstalledPlugin, AuthPluginMap } from "@/lib/auth-providers/types";
import { ENABLED_PROVIDERS } from "@/lib/auth-providers/registry";
import exeDevPlugin from "@/lib/auth-providers/exe-dev/index";
import passkeyPlugin from "@/lib/auth-providers/passkey/index";
import crossDevicePlugin from "@/lib/auth-providers/cross-device/index";
import LoginClient from "./LoginClient";
import { buildPageTitle } from "@/lib/page-title";

export function generateMetadata(): Metadata {
  return { title: buildPageTitle("Login") };
}

// Maps provider ids to their server-side plugin descriptors.
// TypeScript enforces that every ENABLED_PROVIDERS id has exactly one entry here.
const PLUGIN_MAP: AuthPluginMap<typeof ENABLED_PROVIDERS> = {
  "exe-dev": exeDevPlugin,
  "passkey": passkeyPlugin,
  "cross-device": crossDevicePlugin,
};

async function resolveProviders(
  ctx: { headers: { get(name: string): string | null } }
): Promise<InstalledPlugin[]> {
  return Promise.all(
    ENABLED_PROVIDERS.map(async (id) => {
      const plugin = PLUGIN_MAP[id];
      const serverProps = plugin.getServerProps
        ? await plugin.getServerProps(ctx)
        : {};
      return { id: plugin.id, label: plugin.label, serverProps };
    })
  );
}

export default async function LoginPage() {
  const user = await getSessionUser();
  const initialUser = user ? { id: user.id, username: user.username } : null;

  const headerStore = await headers();
  const plugins = await resolveProviders({ headers: headerStore });

  return <LoginClient initialUser={initialUser} plugins={plugins} />;
}
